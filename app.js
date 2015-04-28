/* global Notification */

module.exports = window.App = App

var EventEmitter = require('events').EventEmitter

var shell = require('shell')
var remote = require('remote')
var app = remote.require('app')

var BrowserWindow = remote.require('browser-window')
var catNames = require('cat-names')
var createElement = require('virtual-dom/create-element')
var delegate = require('delegate-dom')
var diff = require('virtual-dom/diff')
var eos = require('end-of-stream')
var h = require('virtual-dom/h')
var inherits = require('inherits')
var patch = require('virtual-dom/patch')
var path = require('path')
var githubCurrentUser = require('github-current-user')
var levelup = require('levelup')
var leveldown = require('leveldown')
var subleveldown = require('subleveldown')

var richMessage = require('./lib/rich-message.js')
var Swarm = require('./lib/swarm.js')
var util = require('./lib/util.js')

var Channels = require('./lib/elements/channels.js')
var Composer = require('./lib/elements/composer.js')
var Messages = require('./lib/elements/messages.js')
var Status = require('./lib/elements/status.js')
var Users = require('./lib/elements/users.js')
var Peers = require('./lib/elements/peers.js')

var currentWindow = remote.getCurrentWindow()

inherits(App, EventEmitter)

function App (el) {
  var self = this
  if (!(self instanceof App)) return new App(el)
  self._notifications = 0

  var db = levelup('./friendsdb', {db: leveldown})

  db.channels = subleveldown(db, 'channels', {valueEncoding: 'json'})

  // Open links in user's default browser
  delegate.on(el, 'a', 'click', function (e) {
    var href = e.target.getAttribute('href')
    if (/^https?:/.test(href)) {
      e.preventDefault()
      shell.openExternal(href)
    } else if (/^#/.test(href)) {
      self.emit('addChannel', href)
    }
  })

  // The mock data model
  self.data = {
    peers: 0,
    username: 'Anonymous (' + catNames.random() + ')',
    channels: [],
    messages: [],
    users: [],
    activeChannel: null
  }

  var swarm = window.swarm = Swarm(subleveldown(db, 'swarm'), {maxPeers: 20})
  githubCurrentUser.verify(function (err, verified, username) {
    if (err || !verified) self.showGitHelp()
    if (err) return console.error(err.message || err)
    if (verified) {
      self.data.username = username
      swarm.username = username
      render()
    }
  })

  var channelsFound = {}
  var usersFound = {}
  var changesOffsets = {}

  swarm.process(function (basicMessage, cb) {
    if (basicMessage.channel === 'channels') {
      if (!channelsFound[basicMessage.text] && basicMessage.valid) {
        channelsFound[basicMessage.text] = {
          id: self.data.channels.length,
          name: basicMessage.text,
          active: false,
          joined: false
        }
        self.data.channels.push(channelsFound[basicMessage.text])
      }
      return cb()
    }
    var message = richMessage(basicMessage)
    var channelName = message.channel || 'friends'

    var channel = channelsFound[channelName]

    if (!channel) {
      channel = channelsFound[channelName] = {
        id: self.data.channels.length,
        name: channelName,
        active: false,
        joined: true,
        peers: 0,
        messages: []
      }
      self.data.channels.push(channel)
      self.data.activeChannel = channel
    } else if (channel.joined === false) {
      channel.joined = true
      channel.peers = channel.peers || 0
      channel.messages = channel.messages || []
      self.data.activeChannel = channel
    }

    if (!changesOffsets[channel.name]) changesOffsets[channel.name] = swarm.changes(channel.name)

    if (self.data.username && !currentWindow.isFocused()) {
      if (message.text.indexOf(self.data.username) > -1) {
        new Notification('Mentioned in #' + channel.name, { // eslint-disable-line
          body: message.username + ': ' + message.text.slice(0, 20)
        })
        self.setBadge()
      }
    }

    var lastMessage = channel.messages[channel.messages.length - 1]
    if (lastMessage && lastMessage.username === message.username) {
      // Last message came from same user, so merge into the last message
      message = richMessage.mergeMessages(lastMessage, message)
    } else {
      channel.messages.push(message)
    }

    if (!message.anon && message.valid && !usersFound[message.username]) {
      usersFound[message.username] = true
      self.data.users[message.username] = {
        avatar: message.avatar,
        blocked: false
      }
      // Add user names to available autocompletes
      self.views.composer.autocompletes.push(message.username)
    }
    if (!message.anon && !message.valid) {
      message.username = 'Allegedly ' + message.username
    }

    if (changesOffsets[channel.name] <= basicMessage.change) {
      render()
      self.views.messages.scrollToBottom()
    }

    cb()
  })

  swarm.on('peer', function (p, channel) {
    var ch = channelsFound[channel]
    if (ch) ch.peers++
    self.data.peers++
    render()
    eos(p, function () {
      if (ch) ch.peers--
      self.data.peers--
      render()
    })
  })

  channelsFound.friends = {
    id: 0,
    name: 'friends',
    active: true,
    peers: 0,
    messages: []
  }

  self.data.channels.push(channelsFound.friends)
  self.data.messages = channelsFound.friends.messages
  self.data.activeChannel = channelsFound.friends

  // View instances used in our App
  self.views = {
    channels: new Channels(self),
    composer: new Composer(self),
    messages: new Messages(self),
    users: new Users(self),
    peers: new Peers(self),
    status: new Status(self)
  }

  // Initial DOM tree render
  var tree = self.render()
  var rootNode = createElement(tree)
  el.appendChild(rootNode)

  function render () {
    var newTree = self.render()
    var patches = diff(tree, newTree)
    rootNode = patch(rootNode, patches)
    tree = newTree
  }

  self.on('render', render)

  self.on('selectChannel', function (channelName) {
    self.data.channels.forEach(function (channel) {
      if (channelName === channel.name) {
        channel.active = true
        channel.peers = channel.peers || 0
        channel.messages = channel.messages || []
        if (!channel.joined) {
          channel.joined = true
          swarm.addChannel(channelName)
        }
        self.data.messages = channel.messages
        self.data.activeChannel = channel
        if (channel.name !== 'friends') db.channels.put(channel.name, {name: channel.name, id: channel.id})
        return
      }
      if (channel.active && !channel.joined) {
        channel.joined = true
      }
      channel.active = false
    })
    render()
    self.views.messages.scrollToBottom()
  })

  self.on('sendMessage', function (text) {
    text = text.trim()
    if (text.length === 0) return

    swarm.send({
      username: self.data.username,
      channel: self.data.activeChannel && self.data.activeChannel.name,
      text: text,
      timestamp: Date.now()
    })
  })

  self.on('addChannel', function (channelName) {
    if (channelName[0] === '#') channelName = channelName.substring(1)
    if (channelName.length === 0) return
    var channel
    if (!channelsFound[channelName]) {
      channel = channelsFound[channelName] = {
        name: channelName,
        id: self.data.channels.length,
        peers: 0,
        joined: true,
        active: false,
        messages: []
      }
      self.data.channels.push(channel)
      swarm.addChannel(channelName)
      db.channels.put(channelName, {
        name: channelName,
        id: self.data.channels.length
      })
      swarm.send({
        username: self.data.username,
        channel: 'channels',
        text: channelName,
        timestamp: Date.now()
      })
    } else if (channelsFound[channelName].joined === false) {
      channel = channelsFound[channelName]
      channel.joined = true
      channel.peers = 0
      channel.messages = []
      swarm.addChannel(channelName)
      db.channels.put(channelName, {
        name: channelName,
        id: self.data.channels.length
      })
    }
    self.emit('selectChannel', channelName)
  })

  self.on('leaveChannel', function (channelName) {
    if (channelName === 'friends') return // can't leave friends for now
    db.channels.del(channelName, function () {
      var channel = channelsFound[channelName]
      if (!channel) return
      var i = self.data.channels.indexOf(channel)
      if (i > -1) self.data.channels.splice(i, 1)
      delete channelsFound[channelName]
      swarm.removeChannel(channelName)
      self.emit('selectChannel', 'friends')
      render()
    })
  })

  self.on('toggleBlockUser', function (username) {
    var user = self.data.users[username]
    if (user) user.blocked = !user.blocked
    render()
  })

  // Update friendly "timeago" time string (once per minute)
  setInterval(function () {
    self.data.activeChannel.messages.forEach(function (message) {
      message.timeago = util.timeago(message.timestamp)
    })
  }, 60 * 1000)

  db.channels.createValueStream()
    .on('data', function (data) {
      data.messages = []
      data.peers = 0
      data.joined = true
      self.data.channels.push(data)
      channelsFound[data.name] = data
      swarm.addChannel(data.name)
    })
    .on('end', function () {
      render()
    })
}

App.prototype.render = function () {
  var self = this
  var views = self.views
  var data = self.data

  return h('div.layout', [
    h('.sidebar', [
      h('.sidebar-scroll', [
        views.channels.render(data.channels),
        views.users.render(data.users),
        views.peers.render(data)
      ]),
      views.status.render(data)
    ]),
    h('.content', [
      views.messages.render(data.activeChannel, data.users),
      views.composer.render()
    ])
  ])
}

App.prototype.showGitHelp = function () {
  var GIT_HELP = 'file://' + path.join(__dirname, 'lib', 'windows', 'git-help.html')

  var gitHelp = new BrowserWindow({
    width: 600,
    height: 525,
    show: false,
    center: true,
    resizable: false
  })

  gitHelp.on('closed', function () {
    gitHelp = null
  })

  gitHelp.loadUrl(GIT_HELP)

  gitHelp.show()
}

App.prototype.setBadge = function (num) {
  if (num === false) {
    return app.dock.setBadge('')
  } else if (num == null) {
    this._notifications++
  } else {
    this._notifications = num
  }
  app.dock.setBadge(this._notifications.toString())
}
