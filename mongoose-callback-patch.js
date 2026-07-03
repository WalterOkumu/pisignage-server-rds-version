'use strict';

const mongoose = require('mongoose');

// 1. Patch mongoose.connect
const originalConnect = mongoose.connect;
mongoose.connect = function (uri, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }
  const promise = originalConnect.call(mongoose, uri, options);
  if (typeof callback === 'function') {
    promise
      .then(result => callback(null, result))
      .catch(err => callback(err));
  }
  return promise;
};

// 2. Patch Query.prototype.exec to support callbacks
const originalQueryExec = mongoose.Query.prototype.exec;
mongoose.Query.prototype.exec = function (op, callback) {
  if (typeof op === 'function') {
    callback = op;
    op = null;
  }
  if (typeof callback === 'function') {
    originalQueryExec.call(this, op)
      .then(result => callback(null, result))
      .catch(err => callback(err));
    return this;
  }
  return originalQueryExec.apply(this, arguments);
};

// 3. Patch Document.prototype.save and Model.prototype.save to support callbacks
const originalDocSave = mongoose.Document.prototype.save || mongoose.Model.prototype.save;
const savePatch = function (...args) {
  const callback = args[args.length - 1];
  if (typeof callback === 'function') {
    const argsWithoutCallback = args.slice(0, -1);
    originalDocSave.apply(this, argsWithoutCallback)
      .then(result => callback(null, result))
      .catch(err => callback(err));
    return;
  }
  return originalDocSave.apply(this, args);
};
if (mongoose.Document.prototype) {
  mongoose.Document.prototype.save = savePatch;
}
if (mongoose.Model.prototype) {
  mongoose.Model.prototype.save = savePatch;
}

// 4. Patch Document.prototype.remove and Model.prototype.remove (removed in Mongoose 7+)
const removePatch = function (options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }
  const promise = this.deleteOne(options);
  if (typeof callback === 'function') {
    promise
      .then(result => callback(null, result))
      .catch(err => callback(err));
  }
  return promise;
};
if (mongoose.Document.prototype && !mongoose.Document.prototype.remove) {
  mongoose.Document.prototype.remove = removePatch;
}
if (mongoose.Model.prototype && !mongoose.Model.prototype.remove) {
  mongoose.Model.prototype.remove = removePatch;
}

// 5. Add/Patch Model.remove (removed in Mongoose 7+)
if (!mongoose.Model.remove) {
  mongoose.Model.remove = function (conditions, callback) {
    const query = this.deleteMany(conditions);
    if (typeof callback === 'function') {
      query.exec(callback);
    }
    return query;
  };
}

// 6. Add/Patch Model.count (removed in Mongoose 7+)
if (!mongoose.Model.count) {
  mongoose.Model.count = function (conditions, callback) {
    const query = this.countDocuments(conditions);
    if (typeof callback === 'function') {
      query.exec(callback);
    }
    return query;
  };
}

// 6b. Add/Patch Model.update (removed in Mongoose 7+)
if (!mongoose.Model.update) {
  mongoose.Model.update = function (conditions, doc, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = null;
    }
    const useUpdateMany = options && options.multi;
    const query = useUpdateMany ? this.updateMany(conditions, doc, options) : this.updateOne(conditions, doc, options);
    if (typeof callback === 'function') {
      query.exec(callback);
    }
    return query;
  };
}

// 7. Patch Model static methods that return queries or promises to accept callbacks
const modelMethodsToPatch = [
  'find', 'findOne', 'exists', 'countDocuments', 'estimatedDocumentCount', 
  'distinct', 'findById', 'findByIdAndDelete', 'findByIdAndRemove', 
  'findByIdAndUpdate', 'findOneAndDelete', 'findOneAndRemove', 
  'findOneAndReplace', 'findOneAndUpdate', 'replaceOne', 'updateOne', 
  'updateMany', 'deleteOne', 'deleteMany'
];

modelMethodsToPatch.forEach(method => {
  const original = mongoose.Model[method];
  if (typeof original === 'function') {
    mongoose.Model[method] = function (...args) {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        const argsWithoutCallback = args.slice(0, -1);
        try {
          const query = original.apply(this, argsWithoutCallback);
          if (query && typeof query.exec === 'function') {
            query.exec(callback);
            return query;
          }
          if (query && typeof query.then === 'function') {
            query.then(res => callback(null, res)).catch(err => callback(err));
            return query;
          }
          return query;
        } catch (err) {
          callback(err);
          return;
        }
      }
      return original.apply(this, args);
    };
  }
});

console.log('Mongoose compatibility patch applied successfully.');
