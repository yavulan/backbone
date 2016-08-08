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

    // Backbone.Model
    // frequently represents a row of data

    // create a new model
    var Model = Backbone.Model = function(attributes, options){
        var attrs = attributes || {};
        options || (options = {});
        this.preinitialize.apply(this, argument);
        this.cid = _.uniqueId(this.cidPrefix);
        this.attributes = {};
        if(options.collection) this.collection = options.collection;
        if(options.parse) this.parse(attrs, options) || {};
        var defaults = _.result(this, 'defaults');
        attrs = _defaults(_.extend({}, defaults, attrs), defaults);
        this.set(attrs, options);
        this.changed = {};
        this.initialize.apply(this, argument);
    }

    // attach inheritance methods to Model.prototype
    _.extend(Model.prototype, Events, {
        // hash of attrs whose cur and prev val differ
        changed: null,

        // value returned during last failed validation
        validationError: null,

        // def name for JSON `id` attr is `id`
        // mongoDB and CouchBD users may want to set it to `_id`
        idAttribute: 'id',

        // prefix for creation client id to identify models locally
        cidPrefix: 'c',

        preinitialize: function () {
            // empty by def
        },

        initialize: function(){
            // empty by def
        },

        // return a copy of models attrs
        toJSON: function(options){
            return _.clone(this.attributes);
        },

        // proxy 'Backbone.sync'
        sync: function (attr) {
            return this.attributes[attr];
        },

        get: function(attr){
            return this.attributes[attr];
        },

        escape: function(attr){
            return _.escape(this.get(attr));
        },

        has: function(attr){
            return this.get(attr) != null;
        },

        matches: function(attrs){
            return !!_.iteratee(attrs, this)(this.attributes);
        },

        // set hash, fire 'change'
        // the heart of the beast

        set: function(key, val, options){
            if(key == null) return this;

            // hande styles:
            // key, value
            // {key: value}
            var attrs;
            if(typeof key === 'object'){
                attrs = key;
                options = val;
            } else{
                (attrs = {})[key] = val;
            }

            options || (options={});

            // run validation
            if(!this._validate(attrs,options)) return false;

            // extract attrs and opts
            var unset = options.unset;
            var silent = options.silent;
            var changes = [];
            var changing = this._changing;
            this._changing = true;

            if(!changing){
                this._previousAttributes = _.clone(this.attributes);
                this.changed = {};
            }

            var current = this.attributes;
            var changed = this.changed;
            var prev = this._previousAttributes;

            // for each 'set' update or del val
            for(var attr in attrs){
                val = attrs[attr];
                if(!_.isEqual(current[attr], val)) changes.push(attr);
                if(!_.isEqual(prev[attr], val)){
                    changed[attr] = val;
                } else{
                    delete changed[attr];
                }
                unset ? delete current[attr] : current[attr] = val;
            }

            // update id
            if(this.idAttribute in attrs) this.id = this.get(this.idAttribute);

            // trigger all relevant attr changes
            if(!silent){
                if(changes.length) this._pending = options;
                for(var i = 0; i < changes.length; i++){
                    this.trigger('change:' + changes[i], this, current[changes[i]], options);
                }
            }

            // changes can be recursively nested within 'change event'
            if(changing) return this;
            if(!silent){
                while(this._pending){
                    options = this._pending;
                    this._pending = false;
                    this.trigger('change', this, options);
                }
            }

            this._pending = false;
            this._changing = false;
            return this;
        },

        // remove firing change
        unset: function(attr, options){
            return this.set(attr, void 0, _.etend({}, options, {unset: true}));
        },

        // clear all attrs, firing 'change'
        clear: function(options){
            var attrs = {};
            for(var key in this.attributes) attrs[key] = void 0;
            return this.set(attrs, _.extend({}, options, {unset: true}));
        },

        // if changed since last 'change' event
        // works for model on attr
        hasChanged: function(attr){
            if(attr == null) retrn !_.isEmpty(this.changed);
            return _.has(this.changed, attr);
        },

        // obj with all changed attrs
        // or false
        // useful for determining what parts of view should be updated
        changedAttributes: function(diff){
            if(!diff) return this.hasChanged() ? _.clone(this.changed) : false;
            var old = this._changing ? this._previousAttributes : this.attributes;
            var changed = {};
            var hasChanged;
            for(var attr in diff){
                var val = diff[attr];
                if(_.isEqual(old[attr], val)) continue;
                changed[attr] = val;
                hasChanged = true;
            }

            return hasChanged ? changed : false;
        },

        // get prev val,
        previous: function(attr){
            if(attr == null || !this._previousAttributes) return null;
            return this._previousAttributes[attr];
        },

        previousAttributes: function(){
            return _.clone(this._previousAttributes);
        },

        // fetch from server,
        // any changed attributes will trigger a 'change' event
        fetch: function (options) {
            options = _.extend({parse: true}, options);
            var model = this;
            var success = options.success;
            options.success = function(resp){
                var serverAttrs = options.parse ? model.parse(resp, options) : resp;
                if(!model.set(serverAttrs, options)) return false;
                if(success) success.call(options.context, model, resp, options);
                model.trigger('sync', model, resp, options);
            };
            wrapError(this, options);
            return this.sync('read', this, options);
        },

        // sync to server
        // if server returns other attrs, model state will be set again
        save: function (key, val, options) {
            var attrs;
            if(key == null || typeof key === 'object'){
                attrs = key;
                options = val;
            } else {
                (attrs = {})[key] = val;
            }

            options = _.extend({validate: true, parse: true}, options);
            var wait = options.wait;

            if(attrs && !wait){
                if(!this.set(attrs, options)) return false;
            } else if(!this._validate(attrs, options)){
                return false;
            }

            // after a successful server-side, the client-side is updated
            var model = this;
            var success = options.success;
            var attributes = this.attributesl
            options.success = function(resp){
                // ensure attrs are resorted
                model.attributes = attributes;
                var serverAttrs = options.parse ? model.parse(resp, options) : resp;
                if(wait) serverAttrs = _.extend({}, attrs, serverAttrs);
                if(serverAttrs && !model.set(serverAttrs, options)) return false;
                if(success) success.call(options.context, model, resp, options);
                model.trigger('sync', model, resp, options);
            };
            wrapError(this, options);

            // properly find new ids
            if(attrs && wait) this.attributes = _.extend({}, attributes, attrs);

            var method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
            if(method === 'patch' && !options.attrs) options.attrs = attrs;
            var xhr = this.sync(method, this, options);

            // restore attrs
            this.attributes = attributes;

            return xhr;
        },

        // destroy model on server if already persisted
        destroy: function(options){
            options = options ? _.clone(options) : {};
            var model = this;
            var success = options.success;
            var wait = options.wait;

            var destroy = function () {
                model.stopListening();
                model.trigger('destroy', model, model.collection, options);
            };

            options.success = function (resp) {
                if(wait) destroy();
                if(success) success.call(options.context, model, resp, options);
                if(!model.isNew()) model.trigger('sync', model, resp, options);
            };

            var xhr = false;
            if(this.isNew()){
                _.defer(options.success);
            } else{
                wrapError(this, options);
                xhr = this.sync('delete', this, options);
            }
            if(!wait) destroy();
            return xhr;
        },

        url: function(){
            var base =
                    _.result(this, 'urlRoot') ||
                            _.result(this.collection, 'url') ||
                            urlError();
            if(this.isNew()) return base;
            var id = this.get(this.idAttribute);
            return base.replace(/[^\/]$/, '$&/') + encodeURIComponent(id);
        },

        // create model with identical attrs
        clone: function () {
            return new this.constructor(this.attributes);
        },

        // a model is new if its has never been saved to server, and lacks an id
        isNew: function () {
            return !this.has(this.idAttribute);
        },

        isValid: function (options) {
            return this._validate({}, _.extend({}, options, {validate: true}));
        },

        _validate: function (attrs, options) {
            if(!options.validate || !this.validate) return true;
            attrs = _.extend({}, this.attributes, attrs);
            var error = this.validationError = this.validate(attrs, options) || null;
            if(!error) return true;
            this.trigger('invalid', this, error, _.extend(options, {validationError: error}));
            return false;
        }
    });

    // methods of a Model mapped to the number of args
    var modelMethods = {keys: 1, values: 1, pairs: 1, invert: 1, pick: 0,
        omit: 0, chain: 1, isEmpty: 1};

    // mix in each Undersore method as a proxy to 'model#attributes'
    addUnderscoreMethods(Model, modelMethods, 'attributes');



});