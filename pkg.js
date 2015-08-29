#!/usr/bin/env node

var os = require('os')
var pkgjson = require('./package.json')
var path = require('path')
var sh = require('shelljs')

var appVersion = pkgjson.version
var appName = pkgjson.name
var electronPackager = './node_modules/.bin/electron-packager'
var electronVersion = pkgjson.dependencies['electron-prebuilt'].substr(1)
var icon = 'static/Icon.icns'

if (process.argv[2] === '--all') {
  // build for all platforms
  var archs = ['ia32', 'x64']
  var platforms = ['linux', 'win32', 'darwin']

  platforms.forEach(function (plat) {
    archs.forEach(function (arch) {
      pack(plat, arch)
    })
  })
} else {
  // build for current platform only
  pack(os.platform(), os.arch())
}

function pack (plat, arch) {
  var outputPath = path.join('.', 'pkg', appVersion, plat, arch)

  sh.exec('./node_modules/.bin/rimraf ' + outputPath)

  // there is no darwin ia32 electron
  if (plat === 'darwin' && arch === 'ia32') return

  var cmd = electronPackager + ' . ' + appName +
    ' --platform=' + plat +
    ' --arch=' + arch +
    ' --version=' + electronVersion +
    ' --app-version' + appVersion +
    ' --icon=' + icon +
    ' --out=' + outputPath +
    ' --prune' +
    ' --ignore=pkg' // ignore the pkg directory or hilarity will ensue
  console.log(cmd)
  sh.exec(cmd)
}
