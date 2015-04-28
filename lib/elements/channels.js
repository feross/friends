module.exports = Channels

var h = require('virtual-dom/h')
var InputPrompt = require('./input-prompt.js')
var inherits = require('util').inherits
var BaseElement = require('./base-element')

function Channels (target) {
  var self = this
  BaseElement.call(this, target)

  self.addChannelPrompt = new InputPrompt({
    className: 'addChannel',
    prompt: '+ Join Channel',
    placeholder: 'Channel name',
    onsubmit: function (channelName) {
      self.send('addChannel', channelName)
    },
    onupdate: function () {
      self.send('render')
    }
  })
}
inherits(Channels, BaseElement)

Channels.prototype.render = function (channels) {
  var self = this

  channels = channels.filter(function (channel) {
    return channel.name !== 'channels'
  }).map(function (channel) {
    var className = channel.active ? 'active' : !channel.joined ? 'inactive' : ''
    return h('li', { className: className }, [
      h('a', {
        href: '#',
        onclick: function () {
          self.send('selectChannel', channel.name)
        }
      }, '#' + channel.name)
    ])
  })

  return [
    h('.heading', 'Channels'),
    h('ul', [
      channels
    ]),
    self.addChannelPrompt.render()
  ]
}
