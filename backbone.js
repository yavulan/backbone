// https://github.com/jashkenas/backbone/blob/master/backbone.js
// learning by rewriting
(function (factory) {
  
  // in browser or on server?
  // self instead of window for 'WebWorker' support
  var root = (typeof self == 'object' && self.self === self && self) || 
            (typeof global == 'object' && global.global === global && global);
  
  // AMD setup          
  if(typeof define === 'function' && define.amd){
    define(['underscore', 'jquery', 'exports'], function(_, $, exports) {
      root.Backbone = factory(root, exports, _, $);
    });
    
    // Node.js or CommonJS
  } else if(typeof exports !== 'undefined'){
    var _ = require('underscore'), $;
    try {$ = require('jquery')} catch (e){}
    factory(root, exports, $);
    
    // browser global
  } else {
    root.Backbone = factory(root, {}, root._, (root.jQuery || root.Zepto || root.ender || root.$));
  }
  
})(function(root, Backbone, _, $) {
  
  // save prev so it can be restored in noConflict mode
  var previousBackbone = root.Backbone; 
  
  // we'll use it later
  var slice = Array.prototype.slice;
  
  // keep in sync with 'package.json'
  Backbone.VERSION = '1.3.3';
  
  // jQuery, Zepto, Ender owns $
  Backbone.$ = $;
  
  // noConflict, returns reference to this Backbone object
  Backbone.noConflict = function () {
    root.Backbone = previousBackbone;
    return this;
  };
  
  // emulateHTTP, will fake 'PATCH', 'PUT', 'DELETE' reqs via '_method' and set 'X-Http-Method-Override' header
  // * for legacy servers
  Backbone.emulateHTTP = false;
  
  // emulateJSON, will encode body as 'application/x-www-form-urlencoded'
  // * for legacy servers
  Backbone.emulateJSON = false;
  
  // Proxy Backbone class methods to Underscore functions
  
  // apply can be slow, so we use methods arg count, if we know it
  var addMethod = function (length, method, attribute){
    switch(length){
      case 1: return function(){
        return _[method](this[attribute]);
      };
      case 2: return function(value){
        return _[method](this[attribute], value);
      };
      case 3: return function(iteratee, context){
        return _[method](this[attribute], cb(iteratee, this), context);
      };
      case 4: return function(iteratee, defaultVal, context){
        return _[method](this[attribute], cb(iteratee, this), defaultVal, context);
      };
      default: return function(){
        var args = slice.call(arguments);
        args.unshift(this[attribute]);
        return _[method].apply(_, args);
      };
    }
  };
  var addUnderscoreMethods = function(Class, methods, attribute) {
    _.each(methods, function(length, method) {
      if(_[method]) Class.prototype[method] = addMethod(length, method, attribute);
    });
  };
  
  // support 'collection.sortBy('attr')' and 'collection.findWhere({id: 1})'
  var cb = function(iteratee, instance){
    if(_.isFunction(iteratee)) return iteratee;
    if(_.isObject(iteratee) && !instance._isModel(iteratee)) return modelMatcher(iteratee);
    if(_.isString(iteratee)) return function(model){ return model.get(iteratee); };
  };
  var modelMatcher = function(attrs){
    var matcher = _.matches(attrs);
    return function(model){
      return matcher(model.attributes);
    };
  };
  
});