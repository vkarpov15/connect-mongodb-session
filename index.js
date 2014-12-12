var mongodb = require('mongodb');
var EventEmitter = require('events').EventEmitter;

module.exports = function(connect) {
  var Store = connect.Store || connect.session.Store;
  var defaults = {
    uri: 'mongodb://localhost:27017/test',
    collection: 'sessions',
    connectionOptions: {},
    expires: 1000 * 60 * 60 * 24 * 14 // 2 weeks
  };

  var MongoDBStore = function(options, callback) {
    var _this = this;
    this._emitter = new EventEmitter();

    if (typeof options === 'function') {
      callback = options;

      options = {};
      for (var key in defaults) {
        options[key] = options[key] || defaults[key];
      }
    } else {
      options = options || {};
      for (var key in defaults) {
        options[key] = options[key] || defaults[key];
      }
    }

    Store.call(this, options);
    this.options = options;

    mongodb.MongoClient.connect(options.uri, options.connectionOptions, function(error, db) {
      if (error) {
        if (callback) {
          return callback(error);
        }
        throw new Error('Error connecting to db: ' + error);
      }

      _this.db = db;

      db.
        collection(options.collection).
        ensureIndex({ expires: 1 }, { expireAfterSeconds: 0 }, function(error) {
          if (error) {
            if (callback) {
              return callback(error);
            }
            throw new Error('Error creating index: ' + error);
          }

          _this._emitter.emit('connected');
          return callback && callback();
        });
    });
  };

  MongoDBStore.prototype = Object.create(Store.prototype);

  MongoDBStore.prototype.get = function(id, callback) {
    var _this = this;

    if (!this.db) {
      return this._emitter.once('connected', function() {
        _this.get.call(_this, id, callback);
      });
    }

    this.db.collection(this.options.collection).
      findOne({ _id: id }, function(error, session) {
        if (error) {
          return callback(error);
        } else if (session) {
          if (!session.expires || new Date < session.expires) {
            return callback(null, session.session);
          } else {
            return _this.destroy(id, callback);
          }
        } else {
          return callback();
        }
      });
  };

  MongoDBStore.prototype.destroy = function(id, callback) {
    if (!this.db) {
      var _this = this;

      return this._emitter.once('connected', function() {
        _this.destroy.call(_this, id, callback);
      });
    }

    this.db.collection(this.options.collection).
      remove({ _id: id }, function(error) {
        callback && callback(error);
      });
  };

  MongoDBStore.prototype.set = function(id, session, callback) {
    if (!this.db) {
      var _this = this;
      
      return this._emitter.once('connected', function() {
        _this.set.call(_this, id, session, callback);
      });
    }

    var sess = {};
    for (var key in session) {
      if (key === 'cookie') {
        sess[key] = session[key].toJSON ? session[key].toJSON() : session[key];
      } else {
        sess[key] = session[key];
      }
    }

    var s = { _id: id, session: sess };
    if (session && session.cookie && session.cookie.expires) {
      s.expires = new Date(session.cookie.expires);
    } else {
      var now = new Date();
      s.expires = new Date(now.getTime() + this.options.expires);
    }

    this.db.collection(this.options.collection).
      update({ _id: id }, s, { upsert: true }, function(error) {
        callback && callback(error);
      });
  };

  return MongoDBStore;
};