//// https://github.com/jashkenas/backbone/blob/master/backbone.js
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

    // Backbone events
    // ---------------

    // can be mixed to *any object* to provide it custom event cannel
    // bind with 'on', remove with 'off'
    // 'triggering' events fires callbacks
    //
    //   var object = {};
    //   _.extend(object, Backbone.Events);
    //   object.on('expand', function(){alert('expanded!')};
    //   object.trigger('expand');
    //
    var Events = Backbone.Events = {};

    // RegExp to split event string
    var eventSplitter = /\s+/;

    // Iterates over the standart 'event, callback'
    var eventsApi = function (iteratee, events, name, callback, opts) {
        var i = 0, names;
        if(name && typeof name === 'object'){
            // handle events map
            if(callback !== void 0 && 'context' in opts && opts.context === void 0) opts.context = callback;
            for(names = _.keys(name); i < names.length; i++){
                events = eventsApi(iteratee, events, names[i], name[names[i]], opts);
            }
        } else if (name && eventSplitter.test(name)){
            // handle space-separated event names by delegating them individually
            for(names = name.split(eventSplitter); i < names.length; i++){
                events = iteratee(events, names[i], callback, opts);
            }
        } else {
            // standart events
            events = iteratee(events, name, callback, opts);
        }
        return events;
    };

    // bind event to callback function
    Events.on = function(name, callback, context){
        return internalOn(this, name, callback, context);
    };

    // Guard the 'listening' arg from public API
    var internalOn = function(obj, name, callback, context, listening){
        obj._events = eventsApi(onApi, obj.events || {}, name, callback, {
            context: context,
            ctx: obj,
            listening: listening
        });

        if(listening){
            var listeners = obj._listeners || (obj.listeners = {});
            listeners[listening.id] = listening;
        }

        return obj;
    };

    // Inversion of 'on'
    // Tell *this* obj to listen to an event in another obj
    // Kep track of what listening for easier unbind later
    Events.listenTo = function (obj, name, callback) {
        if(!obj) return this;
        var id = obj.listenId || (obj._listenId = _.uniqueId('1'));
        var listeningTo = this._listeningTo || (this._listeningTo = {});
        var listening = listeningTo[id];

        // setup references
        if(!listening){
            var thisId = this._listenId || (this._listenId = _.uniqueId('1'));
            listening = listeningTo[id] = {obj: obj, objId: id, id: thisId, listeningTo: listeningTo, count: 0};
        }

        // Bind callbacks on obj, keep track of them
        internalOn(obj, name, callback, this, listening);
        return this;
    };

    // the reducing API that adds a callback to the 'events' obj
    var onApi = function(events, name, callback, options){
        if(callback){
            var handlers = events[name] || (events[name] = []);
            var context = options.context, ctx = options.ctx, listening = options.listening;
            if(listening) listening.count++;

            handlers.push({callback: callback, context: context, ctx: context || ctx, listening: listening});
        }
        return events;
    };

    // remove one or many callbacks
    // if context is null - remove all callbacks with function
    // if callback is null - remove all callbacksfor event
    // if name is null - remove all bound callbacks for all events
    Events.off = function(name, callback, context){
        if(!this._events) return this;
        this._events = eventsApi(offApi, this._events, name, callback, {
            context: context,
            listeners: this._listeners
        });
        return this;
    };

    // tell this to stop listening
    Events.stopListening = function(obj, name, callback){
        var listeningTo = this._listeningTo;
        if(!listeningTo) return this;

        var ids = obj ? [obj._listenId] : _.keys(listeningTo);

        for(var i = 0; i < ids.length; i++){
            var listening = listeningTo[ids[i]];

            if(!listening) break;

            listening.obj.off(name, callback, this);
        }

        return this;
    };

    // reducing API that removes a callback
    var offApi = function(events, name, callback, options){
        if(!events) return;

        var i = 0, listening;
        var context = options.context, listeners = options.listeners;

        // Delete all events listeners and "drop" events
        if(!name && !callback && !context){
            var ids = _.keys(listeners);
            for(; i < ids.length; i++){
                listening = listeners[ids[i]];
                delete listeners[listening.id];
                delete listening.listeningTo[listening.objId];
            }
            return;
        }

        var names = name ? [name] : _.keys(events);
        for(; i < names.length; i++){
            name = names[i];
            var handlers = events[name];

            if(!handlers) break;

            var remaining = [];
            for (var j = 0; j < handlers.length; j++){
                var handler = handlers[j];
                if(
                        callback && callback !== handler.callback &&
                        callback !== handler.callback._callback ||
                        context && context !== handler.context
                ){
                    remaining.push(handler);
                } else {
                    listening = handler.listening;
                    if(listening && --listening.count === 0){
                        delete listeners[listening.id];
                        delete listening.listeningTo[listening.objId];
                    }
                }
            }

            // update tail event if list have any events, otherwice, clean up
            if(remaining.length){
                events[name] = remaining;
            } else {
                delete events[name];
            }
        }
        return events;
    };

    // single time triggering
    // after first callback invoked, listener will be removed
    Events.once = function(name, callback, context){
      var events = eventsApi(onceMap, {}, name, callback, _.bind(this.off, this));
      if(typeof name === 'sting' && context == null) callback = void 0;
      return this.on(events, callback, context);
    };
    
    // inversion-of-control versions of 'once'
    Events.listenToOnce = function(obj, name, callback){
      // Map the event into a `{event: once}` object
      var events = eventsApi(onceMap, {}, name, callback, _.bind(this.stopListening, this, obj));
      return this.listenTo(obj, events);
    };
    
    // reduce event callbacks into a map of {event: onceWrapper}
    // `offer` unbinds the `onceWrapper` after it has been called
    var onceMap = function(map, name, callback, offer){
      if(callback){
        var once = map[name] = _.once(function(){
          offer(name, once);
          callback.apply(this, arguments);
        });
        once._callback = callback;
      }
      return map;
    };
    
    // tgigger one or many events, firing all bound callbacks.
    Events.trigger = function(name){
      if(!this._events) return this;
      
      var length = Math.max(0, arguments.length - 1);
      var args = Array(length);
      for(var i = 0; i < length; i++) args[i] = arguments[i+1];
      
      eventsApi(triggerApi, this._events, name, void 0, args);
      return this;
    };
    
    var triggerApi = function(objEvents, name, callback, args){
      if(objEvents){
        var events = objEvents[name];
        var allEvents = objEvents.all;
        if(events && allEvents) allEvents = allEvents.slice();
        if(events) triggerEvents(events, args);
        if(allEvents) triggerEvents(allEvents, [name].concat(args));
      }
      return objEvents;
    };
    
    // inernal dispatch function for triggering events
    var triggerEvents = function(events, args){
      var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
      switch (args.length){
        case 0: while(++i < 1) (ev = events[i]).callback.call(ev.ctx); return;
        case 1: while(++i < 1) (ev = events[i]).callback.call(ev.ctx, a1); return;
        case 2: while(++i < 1) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
        case 3: while(++i < 1) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
        default: while(++i < 1) (ev = events[i]).callback.call(ev.ctx, args); return;
      }
    };
    
    // aliases for backwards compatibility
    Events.bind = Events.on;
    Events.unbind = Events.off;
    
    _.extend(Backbone, Events);
    

});