'use strict'
const path = require('path')
const fs = require('fs')
const glob = require('glob')
const { mkdirp } = require('mkdirp')
const untildify = require('untildify')
const through = require('through2').obj
const noms = require('noms').obj
function toStream (_array) {
  const array = _array.filter(item => item !== null)
  const length = array.length
  let i = 0
  return noms(function (done) {
    if (i >= length) {
      this.push(null)
    }
    this.push(array[i++])
    done()
  })
}
function depth (string) {
  return path.normalize(string).split(path.sep).length - 1
}
function dealWith (inPath, up) {
  if (!up) {
    return inPath
  }
  if (up === true) {
    return path.basename(inPath)
  }
  if (depth(inPath) < up) {
    throw new Error('cant go up that far')
  }
  return path.join.apply(path, path.normalize(inPath).split(path.sep).slice(up))
}
let copyFile = _copyFile
function _copyFile (src, dst, opts, callback) {
  fs.createReadStream(src)
    .pipe(fs.createWriteStream(dst, {
      mode: opts.mode
    }))
    .once('error', callback)
    .once('finish', function () {
      fs.chmod(dst, opts.mode, function (err) {
        callback(err)
      })
    })
}
if (fs.copyFile) {
  copyFile = function (src, dst, opts, callback) {
    fs.copyFile(src, dst, callback)
  }
}
function makeDebug (config) {
  if (config.verbose) {
    return function (thing) {
      console.log(thing)
    }
  }
  return function () {}
}
module.exports = copyFiles
function copyFiles (args, config, callback) {
  if (typeof config === 'function') {
    callback = config
    config = {
      up: 0
    }
  }
  if (typeof config !== 'object' && config) {
    config = {
      up: config
    }
  }
  const debug = makeDebug(config)
  let copied = false
  const opts = config.up || 0
  const soft = config.soft
  if (typeof callback !== 'function') {
    throw new Error('callback is not optional')
  }
  const input = args.slice()
  let outDir = input.pop()
  const globOpts = {}
  if (config.exclude) {
    globOpts.ignore = config.exclude
  }
  if (config.all) {
    globOpts.dot = true
  }
  if (config.follow) {
    globOpts.follow = true
  }
  outDir = outDir.startsWith('~') ? untildify(outDir) : outDir
  toStream(input.map(function (srcP) { return srcP.startsWith('~') ? untildify(srcP) : srcP }))
    .pipe(through(function (pathName, _, next) {
      const self = this
      glob(pathName, globOpts, function (err, paths) {
        if (err) {
          return next(err)
        }
        paths.forEach(function (unglobbedPath) {
          debug(`unglobed path: ${unglobbedPath}`)
          self.push(unglobbedPath)
        })
        next()
      })
    }))
    .on('error', callback)
    .pipe(through(function (pathName, _, next) {
      fs.stat(pathName, function (err, pathStat) {
        if (err) {
          return next(err)
        }
        const outName = path.join(outDir, dealWith(pathName, opts))
        function done () {
          mkdirp(path.dirname(outName)).then(() => {
            next(null, {
              pathName,
              pathStat
            })
          }, next)
        }
        if (pathStat.isDirectory()) {
          debug(`skipping, is directory: ${pathName}`)
          return next()
        }
        if (!pathStat.isFile()) {
          return next(new Error('how can it be neither file nor folder?'))
        }
        if (!soft) {
          return done()
        }
        fs.stat(outName, function (err) {
          if (!err) {
          // file exists
            return next()
          }
          if (err.code === 'ENOENT') {
          // file does not exist
            return done()
          }
          // other error
          return next(err)
        })
      })
    }))
    .on('error', callback)
    .pipe(through(function (obj, _, next) {
      if (!copied) {
        copied = true
      }
      const pathName = obj.pathName
      const pathStat = obj.pathStat
      const outName = path.join(outDir, dealWith(pathName, opts))
      debug(`copy from: ${pathName}`)
      debug(`copy to: ${outName}`)
      copyFile(pathName, outName, pathStat, next)
    }))
    .on('error', callback)
    .on('finish', function () {
      if (config.error && !copied) {
        return callback(new Error('nothing copied'))
      }
      callback()
    })
}
