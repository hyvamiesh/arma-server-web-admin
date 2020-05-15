var _ = require('lodash')
var events = require('events')
var fs = require('fs')
var filesize = require('filesize')
var Gamedig = require('gamedig')
var usage = require('pidusage')
var fsExtra = require('fs.extra')
var Gamedig = require('gamedig')
var glob = require('glob')
var path = require('path')
var slugify = require('slugify')

var ArmaServer = require('arma-server')

var config = require('../config.js')

var processesInterval = 2000
var queryInterval = 5000
var queryTypes = {
  arma1: 'arma',
  arma2: 'arma2',
  arma2oa: 'arma2',
  arma3: 'arma3',
  arma3_x64: 'arma3',
  cwa: 'operationflashpoint',
  ofp: 'operationflashpoint',
  ofpresistance: 'operationflashpoint'
}

var createServerTitle = function (title) {
  if (config.prefix) {
    title = config.prefix + title
  }

  if (config.suffix) {
    title = title + config.suffix
  }

  return title
}

var Server = function (config, logsManager, modsManager, options) {
  this.config = config
  this.logsManager = logsManager
  this.modsManager = modsManager
  this.update(options)
}

Server.prototype = new events.EventEmitter()

Server.prototype.generateId = function () {
  return slugify(this.title).replace(/\./g, '-')
}

Server.prototype.update = function (options) {
  this.additionalConfigurationOptions = options.additionalConfigurationOptions
  this.admin_password = options.admin_password
  this.allowed_file_patching = options.allowed_file_patching
  this.auto_start = options.auto_start
  this.battle_eye = options.battle_eye
  this.file_patching = options.file_patching
  this.forcedDifficulty = options.forcedDifficulty || null
  this.max_players = options.max_players
  this.missions = options.missions
  this.mods = options.mods || []
  this.motd = options.motd || null
  this.number_of_headless_clients = options.number_of_headless_clients || 0
  this.password = options.password
  this.parameters = options.parameters
  this.persistent = options.persistent
  this.port = options.port || 2302
  this.title = options.title
  this.von = options.von
  this.verify_signatures = options.verify_signatures

  this.id = this.generateId()
  this.port = parseInt(this.port, 10) // If port is a string then gamedig fails
}

function processStats (stats) {
  return {
    cpu: stats.cpu,
    cpuFormatted: stats.cpu.toFixed(0) + ' %',
    memory: stats.memory,
    memoryFormatted: filesize(stats.memory)
  }
}

Server.prototype.queryProcesses = function () {
  if (!this.instance) {
    return
  }

  var self = this
  var headlessPids = this.headlessClientInstances.map(function (instance) {
    return instance.pid
  })
  var serverPid = self.instance.pid
  var pids = [serverPid].concat(headlessPids)
  usage(pids, function (err, stats) {
    if (!self.instance) {
      return
    }

    if (err) {
      self.processes = null
    } else {
      self.processes = pids.map(function (pid, idx) {
        var pidStats = processStats(stats[pid])
        if (pid === serverPid) {
          pidStats.name = 'Server'
        } else {
          pidStats.name = 'Headless ' + idx // First headless at idx 1
        }
        return pidStats
      })
    }

    self.emit('state')
  })
}

Server.prototype.queryStatus = function () {
  if (!this.instance) {
    return
  }

  var self = this
  Gamedig.query(
    {
      type: queryTypes[config.game],
      host: '127.0.0.1',
      port: self.port
    },
    function (state) {
      if (!self.instance) {
        return
      }

      if (state.error) {
        self.state = null
      } else {
        self.state = state
      }

      self.emit('state')
    }
  )
}

Server.prototype.getMods = function () {
  var self = this
  return this.mods.map(function (mod) {
    return self.modsManager.find(mod)
  }).filter(function (mod) {
    return mod
  }).map(function (mod) {
    if (config.type === 'linux' && config.steam && config.steam.path) {
      return mod.path.replace(config.steam.path, 'workshop/')
    }

    return mod.path
  })
}

Server.prototype.getParameters = function () {
  var parameters = []

  if (config.parameters && Array.isArray(config.parameters)) {
    parameters = parameters.concat(config.parameters)
  }

  if (this.parameters && Array.isArray(this.parameters)) {
    parameters = parameters.concat(this.parameters)
  }

  return parameters
}

Server.prototype.getAdditionalConfigurationOptions = function () {
  var additionalConfigurationOptions = ''

  if (config.additionalConfigurationOptions) {
    additionalConfigurationOptions += config.additionalConfigurationOptions
  }

  if (this.additionalConfigurationOptions) {
    if (additionalConfigurationOptions) {
      additionalConfigurationOptions += '\n'
    }

    additionalConfigurationOptions += this.additionalConfigurationOptions
  }

  return additionalConfigurationOptions
}

Server.prototype.start = function () {
  if (this.instance) {
    return this
  }

  var self = this

  const mods = this.getMods()
  const requiredFileExtensions = ['.dll', '.exe', '.so', '.txt']
  const serverFolders = [
    'addons',
    'argo',
    'battleye',
    'contact',
    'curator',
    'dll',
    'dta',
    'enoch',
    'expansion',
    'gm',
    'heli',
    'jets',
    'kart',
    'mark',
    'mpmissions',
    'orange',
    'tacops',
    'tank'
  ]
  const symlinkFolders = serverFolders.concat(mods).concat(config.serverMods)

  return fs.promises.mkdtemp(path.join(self.config.path, 'arma-server-'))
    .then((serverFolder) => {
      self.virtualServerFolder = serverFolder
      console.log('Created virtual server folder:', serverFolder)

      return fs.promises.readdir(self.config.path)
        .then((files) => {
          // Copy needed files, file symlinks on Windows are sketchy
          const serverFiles = files.filter((file) => requiredFileExtensions.indexOf(path.extname(file)) >= 0 || path.basename(file) === 'arma3server')
          return Promise.all(serverFiles.map((file) => {
            return fs.promises.copyFile(path.join(self.config.path, file), path.join(serverFolder, file))
          }))
        })
        .then(() => {
          // Create virtual folders from default Arma and mods
          return Promise.all(symlinkFolders.map((symlink) => {
            return fs.promises.access(path.join(self.config.path, symlink))
              .then(() => {
                if (self.config.type === 'linux') {
                  return fs.promises.mkdir(path.join(serverFolder, symlink, '..'), { recursive: true })
                }
              })
              .then(() => {
                if (!path.isAbsolute(symlink)) {
                  return fs.promises.symlink(path.join(self.config.path, symlink), path.join(serverFolder, symlink), 'junction')
                }
              })
              .catch((err) => {
                console.error('Could create symlink for', symlink, 'due to', err)
              })
          }))
        })
        .then(() => {
          // Copy needed keys, file symlinks on Windows are sketchy
          const keysFolder = path.join(serverFolder, 'keys')
          return fs.promises.mkdir(keysFolder, { recursive: true })
            .then(() => {
              const defaultKeysPath = path.join(self.config.path, 'keys')
              const defaultKeysPromise = fs.promises.readdir(defaultKeysPath)
                .then((files) => files.filter((file) => path.extname(file) === '.bikey'))
                .then((files) => files.map((file) => path.join(defaultKeysPath, file)))

              const modKeysPromise = Promise.all(mods.map(mod => {
                return new Promise((resolve, reject) => {
                  const modPath = path.isAbsolute(mod) ? mod : path.join(this.config.path, mod)
                  glob(`${modPath}/**/*.bikey`, function (err, files) {
                    if (err) {
                      return reject(err)
                    }

                    return resolve(files)
                  })
                })
              })).then((modsFiles) => modsFiles.flat())

              return Promise.all([defaultKeysPromise, modKeysPromise].map((promise) => {
                return promise.then((keyFiles) => {
                  return Promise.all(keyFiles.map((keyFile) => {
                    return fs.promises.copyFile(keyFile, path.join(keysFolder, path.basename(keyFile)))
                  }))
                })
              })).catch((err) => {
                console.error('Error copying keys:', err)
              })
            })
        })
        .then(() => {
          self.realStart(serverFolder)
        })
        .catch((err) => {
          console.error('Error creating virtual server folder:', err)
        })
    })
}

Server.prototype.realStart = function (path) {
  if (this.instance) {
    return this
  }

  var mods = this.getMods()
  var parameters = this.getParameters()
  var server = new ArmaServer.Server({
    additionalConfigurationOptions: this.getAdditionalConfigurationOptions(),
    admins: config.admins,
    allowedFilePatching: this.allowed_file_patching || 1,
    battleEye: this.battle_eye ? 1 : 0,
    config: this.id,
    disableVoN: this.von ? 0 : 1,
    game: config.game,
    filePatching: this.file_patching || false,
    forcedDifficulty: this.forcedDifficulty || null,
    headlessClients: this.number_of_headless_clients > 0 ? ['127.0.0.1'] : null,
    hostname: createServerTitle(this.title),
    localClient: this.number_of_headless_clients > 0 ? ['127.0.0.1'] : null,
    missions: this.missions,
    mods: mods,
    motd: (this.motd && this.motd.split('\n')) || null,
    parameters: parameters,
    password: this.password,
    passwordAdmin: this.admin_password,
    path: path,
    persistent: this.persistent ? 1 : 0,
    platform: this.config.type,
    players: this.max_players,
    port: this.port,
    serverMods: config.serverMods,
    verifySignatures: this.verify_signatures ? 2 : 0
  })
  server.writeServerConfig()
  var instance = server.start()
  var self = this

  var logStream = null
  if (this.config.type === 'linux') {
    logStream = fs.createWriteStream(this.logsManager.generateLogFilePath(), {
      flags: 'a'
    })
  }

  instance.stdout.on('data', function (data) {
    if (logStream) {
      logStream.write(data)
    }
  })

  instance.stderr.on('data', function (data) {
    if (logStream) {
      logStream.write(data)
    }
  })

  instance.on('close', function (code) {
    if (logStream) {
      logStream.end()
    }

    clearInterval(self.queryProcessesInterval)
    clearInterval(self.queryStatusInterval)
    self.state = null
    self.processes = null
    self.pid = null
    self.instance = null

    self.stopHeadlessClients()
      .then(() => {
        if (self.virtualServerFolder) {
          fsExtra.rmrf(self.virtualServerFolder, function (err) {
            if (err) {
              console.log('Error removing virtual server folder', err)
            }
          })
          self.virtualServerFolder = null
        }

        self.emit('state')
      })
  })

  instance.on('error', function (err) {
    console.log(err)
  })

  this.pid = instance.pid
  this.instance = instance
  this.queryProcessesInterval = setInterval(function () {
    self.queryProcesses()
  }, processesInterval)
  this.queryStatusInterval = setInterval(function () {
    self.queryStatus()
  }, queryInterval)

  this.startHeadlessClients(path)

  this.emit('state')

  return this
}

Server.prototype.startHeadlessClients = function () {
  var mods = this.getMods()
  var parameters = this.getParameters()
  var self = this
  var headlessClientInstances = _.times(this.number_of_headless_clients, function (i) {
    var headless = new ArmaServer.Headless({
      filePatching: self.file_patching,
      game: config.game,
      host: '127.0.0.1',
      mods: mods,
      parameters: parameters,
      password: self.password,
      path: path,
      platform: self.config.type,
      port: self.port
    })
    var headlessInstance = headless.start()
    var name = 'HC_' + i
    var logPrefix = self.id + ' ' + name
    console.log(logPrefix + ' starting')

    headlessInstance.stdout.on('data', function (data) {
      console.log(logPrefix + ' stdout: ' + data)
    })

    headlessInstance.stderr.on('data', function (data) {
      console.log(logPrefix + ' stderr: ' + data)
    })

    headlessInstance.on('close', function (code) {
      console.log(logPrefix + ' exited: ' + code)

      var elementIndex = headlessClientInstances.indexOf(headlessInstance)
      if (elementIndex !== -1) {
        headlessClientInstances.splice(elementIndex, 1)
      }
    })

    headlessInstance.on('error', function (err) {
      console.log(logPrefix + ' error: ' + err)
    })

    return headlessInstance
  })

  this.headlessClientInstances = headlessClientInstances
}

Server.prototype.stop = function (cb) {
  var handled = false

  this.instance.on('close', function (code) {
    if (!handled) {
      handled = true

      if (cb) {
        cb()
      }
    }
  })

  this.instance.kill()

  setTimeout(function () {
    if (!handled) {
      handled = true

      if (cb) {
        cb()
      }
    }
  }, 5000)

  return this
}

Server.prototype.stopHeadlessClients = function () {
  return Promise.all(this.headlessClientInstances.map(function (headlessClientInstance) {
    return headlessClientInstance.kill()
  }))
}

Server.prototype.toJSON = function () {
  return {
    additionalConfigurationOptions: this.additionalConfigurationOptions,
    admin_password: this.admin_password,
    allowed_file_patching: this.allowed_file_patching,
    auto_start: this.auto_start,
    battle_eye: this.battle_eye,
    id: this.id,
    file_patching: this.file_patching,
    forcedDifficulty: this.forcedDifficulty,
    max_players: this.max_players,
    missions: this.missions,
    motd: this.motd,
    mods: this.mods,
    number_of_headless_clients: this.number_of_headless_clients,
    parameters: this.parameters,
    password: this.password,
    persistent: this.persistent,
    pid: this.pid,
    port: this.port,
    processes: this.processes,
    state: this.state,
    title: this.title,
    von: this.von,
    verify_signatures: this.verify_signatures
  }
}

module.exports = Server
