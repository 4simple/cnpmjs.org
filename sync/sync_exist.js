/*!
 * cnpmjs.org - sync/sync_exist.js
 *
 * Copyright(c) cnpmjs.org and other contributors.
 * MIT Licensed
 *
 * Authors:
 *  dead_horse <dead_horse@qq.com> (http://deadhorse.me)
 */

'use strict';

/**
 * Module dependencies.
 */

var config = require('../config');
var Npm = require('../proxy/npm');
var Module = require('../proxy/module');
var Total = require('../proxy/total');
var eventproxy = require('eventproxy');
var SyncModuleWorker = require('../proxy/sync_module_worker');
var debug = require('debug')('cnpmjs.org:sync:sync_hot');
var utility = require('utility');
var Status = require('./status');
var ms = require('ms');

function intersection(arrOne, arrTwo) {
  arrOne = arrOne || [];
  arrTwo = arrTwo || [];
  var map = {};
  var results = [];
  arrOne.forEach(function (name) {
    map[name] = true;
  });
  arrTwo.forEach(function (name) {
    map[name] && results.push(name);
  });
  return results;
}

module.exports = function sync(callback) {
  var ep = eventproxy.create();
  ep.fail(callback);
  var syncTime = Date.now();

  Module.listShort(ep.doneLater(function (packages) {
    packages = packages.map(function (p) {
      return p.name;
    });
    ep.emit('existPackages', packages);
  }));
  Total.getTotalInfo(ep.doneLater('totalInfo'));

  ep.once('totalInfo', function (info) {
    if (!info) {
      return callback(new Error('can not found total info'));
    }
    if (!info.last_exist_sync_time) {
      debug('First time sync all packages from official registry');
      return Npm.getShort(ep.done(function (pkgs) {
        if (!info.last_sync_module) {
          return ep.emit('allPackages', pkgs);
        }
        // start from last success
        var lastIndex = pkgs.indexOf(info.last_sync_module);
        if (lastIndex > 0) {
          pkgs = pkgs.slice(lastIndex);
        }
        ep.emit('allPackages', pkgs);
      }));
    }
    Npm.getAllSince(info.last_exist_sync_time - ms('10m'), ep.done(function (data) {
      if (!data) {
        return ep.emit('allPackages', []);
      }
      if (data._updated) {
        syncTime = data._updated;
        delete data._updated;
      }

      return ep.emit('allPackages', Object.keys(data));
    }));
  });

  ep.all('existPackages', 'allPackages', function (existPackages, allPackages) {
    var packages = intersection(existPackages, allPackages);
    debug('Total %d packages to sync', packages.length);
    var worker = new SyncModuleWorker({
      username: 'admin',
      name: packages,
      concurrency: config.syncConcurrency,
    });
    Status.init({
      worker: worker,
      need: packages.length
    }).start();
    worker.start();
    worker.once('end', function () {
      debug('All packages sync done, successes %d, fails %d',
        worker.successes.length, worker.fails.length);
      Total.setLastExistSyncTime(syncTime, utility.noop);
      callback(null, {
        successes: worker.successes,
        fails: worker.fails
      });
    });
  });
};
