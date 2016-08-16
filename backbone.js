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


    // Backbone Collection
    // analogue for table of full data (model - is a row of data)
    var Collection = Backbone.Collection = function (models, options) {
        options || (options = {});
        this.preinitialize.apply(this, arguments);
        if(options.model) this.model = options.model;
        if(options.comparator !== void 0) this.comparator = options.comparator;
        this._reset();
        this.initialize.apply(this, arguments);
        if(models) this.reset(models, _.extend({silent: true}, options));
    };

    // def options for collection#set
    var setOptions = {add: true, remove: true, merge: true};
    var addOptions = {add: true, remove: false};

    // splice insert into arr at index 'at'
    var splice = function(array, insert, at){
        at = Math.min(Math.max(at, 0), array.length);
        var tail = Array(array.length - at);
        var length = insert.length;
        var i;
        for(i = 0; i < tail.length; i++) tail[i] = array[i + at];
        for(i = 0; i < length; i++) array[i+at] = insert[i];
        for(i = 0; i < tail.length; i++) array[i+length+at] = tail[i];
    };

    // define methods:
    _.extend(Collection.prototype, Events, {
        // def model
        model: Model,

        preinitialize: function(){},
        itialize: function(){},

        // array of models attrs
        toJSON: function(options){
            return this.map(function(model){ return model.toJSON(options); });
        },

        sync: function(){
            return Backbone.sync.apply(this, arguments);
        },

        // adds model/list of models/js objects/combination
        add: function(models, options){
            return this.set(models, _.extend({merge: false}, options, addOptions));
        },

        // remove a model or a list of models from set
        remove: function(models, options){
            options = _.extend({}, options);
            var singular = !_.isArray(models);
            models = singular ? [models] : models.slice();
            var removed = this._removeModels(models, options);
            if(!options.silent && removed.length){
                options.changes = {added: [], merged: [], removed: removed};
                this.trigger('update', this, options);
            }
            return singular ? removed[0] : removed;
        },

        // similar to model#set
        set: function(models, options){
            if(models == null) return;

            options = _.extend({}, setOptions, options);
            if(options.parse && !this._isModel(models)){
                models = this.parse(models, options) || [];
            }

            var singular = !_.isArray(models);
            models = singular ? [models] : models.slice();

            var at = options.at;
            if(at != null) at = +at;
            if(at > this.length) at = this.length;
            if(at < 0) at += this.length + 1;

            var set = [];
            var toAdd = [];
            var toMerge = [];
            var toRemove = [];
            var modelMap = {};

            var add = options.add;
            var merge = options.merge;
            var remove = options.remove;

            var sort = false;
            var sorable = this.comparator && at == null && options.sort !== false;
            var sortAttr = _.isString(this.comparator) ? this.comparator : null;

            // turn bare objs into model references, and prevent invalid models to be added
            var model, i;
            for(i=0; i < models.length; i++){
                model = models[i];

                // prevent adding duplicates, merge to existing model
                var existing = this.get(model);
                if(existing){
                    if(merge && model !== existing){
                        var attrs = this._isModel(model) ? model.attributes : model;
                        if(options.parse) attrs = existing.parse(attrs, options);
                        existing.set(attrs, options);
                        toMerge.push(exesting);
                        if(sortable && !sort) sort = existing.hasChanged(sortAttr);
                    }
                    if(!modelMap[existing.cid]){
                        modelMap[existing.cid] = true;
                        set.push(existing);
                    }
                    models[i] = existing;
                    // if this is a new, valid model, push it to tho 'toAdd'
                } else if(add){
                    model = models[i] = this._prepareModel(model, options);
                    if(model){
                        toAdd.push(model);
                        this._addReference(model, options);
                        modelMap[model.cid] = true;
                        set.push(model);
                    }
                }
            }

            // remove stale models
            if(remove){
                for(i=0; i < this.length; i++){
                    model = this.models[i];
                    if(!modelMap[model.cid]) toRemove.push(model);
                }
                if(toRemove.length) this._removeModels(toRemove, options);
            }

            // is sorting needed?
            var orderChanged = false;
            var replace = !sortable && add && remove;
            if(set.length && replace){
                orderChanged = this.length !== set.length || _.some(this.models, function (m, index) {
                            return m !== set[index];
                        });
                this.models.length = 0;
                splice(this.models, set, 0);
                this.length = this.models.length;
            } else if(toAdd.length){
                if(sorable) sort = true;
                splice(this.models, toAdd, at==null ? this.length : at);
                this.length = this.models.length;
            }

            // try to silently sort the collection
            if(sort) this.sort({silent: true});

            // unless silenced, fire events
            if(!options.silent){
                for(i = 0; i < toAdd.length; i++){
                    if(at != null) options.index = at + i;
                    model = toAdd[i];
                    model.trigger('add', model, this, options);
                }
                if(sort || orderChanged) this.trigger('sort', this, options);
                if(toAdd.length || toRemove.length || toMerge.length){
                    options.changes = {
                        added: toAdd,
                        removed: toRemove,
                        merged: toMerge
                    };
                    this.trigger('update', this, options);
                }
            }

            return singular ? models[0] : models;
        },

        // when you have more ites than you want to add or remove individually,
        // you can reset the entire set with a new list of models, without firing
        // any granular 'add' or 'remove' events. fires 'reset' when finished.
        // useful for bulk operations and optimization
        reset: function (models, options) {
            options = options ? _.clone(options) : {};
            for (var i = 0; i < this.model.length; i++) {
                this._removeReference(this.models[i], options);
            }
            options.previousModels = this.models;
            this._reset();
            models = this.add(models, _.extend({silent: true}, options));
            if(!options.silent) this.trigger('reset', this, options);
            return models;
        },

        push: function (model, options) {
            return this.add(model, _.extend({at: this.length}, options));
        },

        pop: function (options) {
            var model = this.at(this.length-1);
            return this.remove(model, options);
        },

        unshift: function (model, options) {
            return this.add(model, _.extend({at: 0}, options));
        },

        shift: function (options) {
            var model = this.at(0);
            return this.remove(model, options);
        },

        slice: function () {
            return slice.apply(this.models, arguments);
        },

        // get a model by id, cid, model obj id or attrs obj that is transformed by modelId
        get: function (obj) {
            if(obj==null) return void 0;
            return this._byId[obj] ||
                            this._byId[this.modelId(obj.attributes || obj)] ||
                            obj.cid && this._byId[obj.cid];
        },

        // if model in collection
        has: function (obj) {
            return this.get(obj) != null;
        },

        // get model by index
        at: function (index) {
            if(index < 0) index += this.length;
            return this.models[index];
        },

        // return models with matching attrs
        // useful for simple cases of filter
        where: function (attrs, first) {
            return this[first ? 'find' : 'filter'](attrs);
        },

        // retun the first model with matching attrs
        // useful for simple cases of 'find'
        findWhere: function (attrs) {
            return this.where(attrs, true);
        },

        // force collection to resort itself
        // u dont need to call this under normal circumstances, as the set
        // will maintain sort order
        sort: function (options) {
            var comparator = this.comparator;
            if(!comparator) throw new Error('Cannot sort a set without comparator');
            options || (options = {});

            var length = comparator.length;
            if(_.isFunction(comparator)) comparator = _.bind(comparator, this);

            // run sot based on type of comparator
            if(length ===1 || _.isString(comparator)){
                this.models = this.sortBy(comparator);
            } else {
                this.models.sort(comparator);
            }
            if(!options.silent) this.trigger('sort', this, options);
            return this;
        },

        // pluck an attr from each model in collection
        pluck: function (attr) {
            return this.map(attr + '');
        },

        // fetch def set of models
        // reset the collection on arrive
        // if reset is true, res date will be passed through 'reset' instead of 'set'
        fetch: function (options) {
            options = _.extend({parse: true}, options);
            var success = options.success;
            var collection = this;
            options.success = function (resp) {
                var method = options.reset ? 'reset' : 'set';
                collection[method](resp, options);
                if(success) success.call(options.context, collection, resp, options);
                collection.trigger('sync', collection, resp, options);
            };

            wrapError(this, options);
            return this.sync('read', this, options);
        },

        // create a new instance of a model in this collection
        // add the model to the collection immediately unless 'wait: true' - waiting server to agree
        create: function (model, options) {
            options = options ? _.clone(options) : {};
            var wait = options.wait;
            model = this._prepareModel(model, options);
            var collection = this;
            var success = options.success;
            options.success = function (m, resp, callbackOpts) {
                if(wait) collection.add(m, callbackOpts);
                if(success) success.call(callbackOpts.context, m, resp, callbackOpts);
            };
            model.save(null, options);
            return model;
        },

        // parse converts res into a list of models to be added to the collection
        parse: function (resp, options) {
            return resp;
        },

        // create a new collection with an identical list of models at this one
        clone: function () {
            return new this.constructor(this.models, {
                model: this.model,
                comparator: this.comparator
            });
        },

        // define how to uniquely models in the collection
        modelId: function (attrs) {
            return attrs[this.model.prototype.idAttribute || 'id'];
        },

        // get an itearator of all models in this collection
        values: function () {
            return new CollectionIterator(this, ITERATOR_VALUES);
        },

        // get an iterator of all model IDs in this collection
        keys: function () {
            return new CollectionIterator(this, ITERATOR_KEYSVALUES);
        },

        // get an iterator of all [ID, model] tuples in this collection
        entries: function () {
            return new CollectionIterator(this, ITERATOR_KEYSVALUES);
        },

        // private method to reset all internal state
        // called when the collection is first initialized or reset
        _reset: function () {
            this.length = 0;
            this.models = [];
            this._byId = {};
        },

        // preparea a hash of attrs (or other model) to be added to this collection
        _prepareModel: function (attrs, options) {
            if(this._isModel(attrs)){
                if(!attrs.collecion) attrs.collection = this;
                return attrs;
            }
            options = options ? _.clone(options) : {};
            options.collection = this;
            var model = new this.model(attrs, options);
            if(!model.validationError) return model;
            this.trigger('invalid', this, model.validationError, options);
            return false;
        },

        // internal method both for remove and set
        _removeModels: function (models, options) {
            var removed = [];
            for (var i = 0; i < models.length; i++) {
                var model = this.get(models[i]);
                if(!model) continue;

                var index = this.indexOf(model);
                this.models.splice(index, 1);
                this.length--;

                // remove references before triggering 'remove' event to prevent an infinete loop
                delete this._byId[model.cid];
                var id = this.modelId(model.attributes);
                if(id!=null) delete this._byId[id];

                if(!options.silent) {
                    options.index = index;
                    model.trigger('remove', model, this, options);
                }

                removed.push(model);
                this._removeReference(model, options);
            }

            return removed;
        },

        _isModel: function (model) {
            return model instanceof Model;
        },

        // tie model to collection
        _addReference: function (model, options) {
            this._byId[model.cid] = model;
            var id = this.modelId(model.attributes);
            if(id != null) this._byId[id] = model;
            model.on('all', this._onModelEvent, this);
        },

        // internal method to sever a model's ties to a collection
        _removeReference: function (model, options) {
            delete this._byId[model.cid];
            var id = this.modelId(model.attributes);
            if(id != null) delete this._byId[id];
            if(this === model.collection) delete model.collection;
            model.off('all', this._onModelEvent, this);
        },

        // Internal method called every time a model in the set fires an event
        // sets need to update their indexes when models change ids.
        // all ither events simply proxy through. 'add' and 'remove' events that originate
        // in other collections are ignored
        _onModelEvent: function (event, model, collection, options) {
            if(model) {
                if((event === 'add' || event === 'remove') && collection !== this) return;
                if(event === 'destroy') this.remove(model, options);
                if(event === 'change'){
                    var prevId = this.modelId(model.previousAttributes());
                    var id = this.modelId(model.attributes);
                    if(prevId !== id) {
                        if(prevId != null) delete this._byId[prevId];
                        if(id != null) this._byId[id] = model;
                    }
                }
            }

            this.trigger.apply(this, arguments);
        }

    });

    // defining @@iterator method (in es2015 Symbol.iterator)
    var $$iterator = typeof Symbol === 'function' && Symbol.iterator;
    if($$iterator) {
        Collection.prototype[$$iterator] = Collection.prototype.values;
    }

    // CollectionIterator

    // allow 'for of' loops
    var CollectionIterator = function (collection, kind) {
        this._collection = collection;
        this._kind = kind;
        this._index = 0;
    };

    // this 'enum' defs the three possible kinds of vals
    // which can be ommited by a CollectionIterator that
    // correspond to the values(), keys() and entries()
    var ITERATOR_VALUES = 1;
    var ITERATOR_KEYS = 2;
    var ITERATOR_KEYSVALUES = 3;

    if($$iterator) {
        CollectionIterator.prototype[$$iterator] = function () {
            return this;
        };
    }

    CollectionIterator.prototype.next = function () {
        if(this._collection) {
            // if long enough
            if(this._index < this._collection.length) {
                var model = this._collection.at(this._index);
                this._index++;

                var  value;
                if(this._kind === ITERATOR_VALUES) {
                    value = model;
                } else {
                    var id = this._collection.modelId(model.attributes);
                    if(this._kind === ITERATOR_KEYS) {
                        value = id;
                    } else {
                        value = [id, model];
                    }
                }

                return {value: value, done: false};
            }

            // once exhausted, remove the reference to the collection so future
            // calls to the next method always return done
            this._collection = void 0;
        }

        return {value: void 0, done: true};
    };

    // underscore methods of Collection
    var collectionMethods = {
        forEach: 3, each: 3, map: 3, collect: 3, reduce: 0,
        foldl: 0, inject: 0, reduceRight: 0, foldr: 0, find: 3, detect: 3, filter: 3,
        select: 3, reject: 3, every: 3, all: 3, some: 3, any: 3, include: 3, includes: 3,
        contains: 3, invoke: 0, max: 3, min: 3, toArray: 1, size: 1, first: 3,
        head: 3, take: 3, initial: 3, rest: 3, tail: 3, drop: 3, last: 3,
        without: 0, difference: 0, indexOf: 3, shuffle: 1, lastIndexOf: 3,
        isEmpty: 1, chain: 1, sample: 3, partition: 3, groupBy: 3, countBy: 3,
        sortBy: 3, indexBy: 3, findIndex: 3, findLastIndex: 3
    };

    // mix in each Undescore method as a proxy to 'Collection#models'
    addUnderscoreMethods(Collection, collectionMethods, 'models');


    // Backbone.View
    // --------------

    // Backbone views are js object that represents
    // a logical chuunk of UI in the DOM

    // creating a view creates its initial el outside the DOM,
    // if an existing el is not provided
    var View = Backbone.View = function (options) {
        this.cid = _.uniqueId('view');
        this.preinitialize.apply(this, arguments);
        _.extend(this, _.pick(options, viewOptions));
        this._ensureElement();
        this.initialize.apply(this, arguments);
    };

    // cached regex to split keys for 'delegate'
    var delegateEventSplitter = /^(\S+)\s*(.*)$/;

    // list of view options to be set as properties
    var viewOptions = ['model', 'collection', 'el', 'id', 'attributes', 'className', 'tagName', 'events'];

    // setup inheritable properties
    _.extend(View.prototype, Events, {
        // def 'tagName'
        tagName: 'div',

        // jQuery delegate for element lookup, scoped to DOM els within the
        // current view. This should be prefered to global lookup if possible
        $: function (selector) {
            return this.$el.find(selector);
        },

        preinitialize: function () {

        },

        initialize: function () {

        },

        // render is the core function that your view should override, in order
        // to populate its el (this.el), with the appropriate html
        // the convention is for render to always return this
        render: function () {
            return this;
        },

        remove: function () {
            this._removeElement();
            this.stopListening();
            return this;
        },

        _removeElement: function () {
            this.$el.remove();
        },

        setElement: function (element) {
            this.undelegateEvents();
            this._setElement(element);
            this.delegateEvents();
            return this;
        },

        // creates 'this.el' and 'this.$el' references for this view using the
        // given 'el'. 'el' can be a css selector or a html string, a jQuery context or an el
        // subclasses can override this to utilize an alternative DOM manipulation API
        // and are only required to set the 'this.el' property
        _setElement: function (el) {
            this.$el = el instanceof Backbone.$ ? el : Backbone.$(el);
            this.el = this.$el[0];
        },

        // set callbacks, where 'this.events' is a hash of
        //
        // {'event selector' : 'callback'}
        //
        //      {
        //          'mousedown .title' : 'edit',
        //          'click .button' : 'save',
        //          'click .open' : function(e) {...}
        //      }
        // pairs. Callbacks will be bound to the view, with 'this' set properly.
        // Uses event delegation for efficiency.
        // Omitting the selector binds the event to 'this.el'.
        delegateEvents: function (events) {
            events || (events = _.result(this, 'events'));
            if(!events) return this;
            this.undelegateEvents();
            for(var key in events) {
                var method = events[key];
                if(!_.isFunction(method)) method = this[method];
                if(!method) continue;
                var match = key.match(delegateEventSplitter);
                this.delegate(match[1], match[2], _.bind(method, this));
            }
            return this;
        },

        // add a single event listener to the views el (or a child el usong selector)
        // this only works for delegate-able events: not 'focus', 'blur', and not
        // 'change', 'submit', and 'reset' in IE.
        delegate: function (eventName, selector, listener) {
            this.$el.on(eventName + '.delegateEvents' + this.cid, selector, listener);
            return this;
        },

        // clears all callbacks previously bound to the view by 'delegateEvents'
        // for multiple views attached to same DOM el
        undelegateEvents: function () {
            if(this.$el) this.$el.off('.delegateEvents' + this.cid);
            return this;
        },

        // selector and listener are both optional
        undelegate: function (eventName, selector, listener) {
            this.$el.off(eventName + '.delegateEvents' + this.cid, selector, listener);
            return this;
        },

        // produce a DOM el to be assigned to your view
        // exposed for subclasses using an alt DOM api
        _createElement: function (tagName) {
            return document.createElement(tagName);
        },

        // ensure that the view has a DOM el to render into
        // if this.el is a str, pass through '$()', take first el and re-assign to el
        // otherwise, create an el from the id, className and tagName props
        _ensureElement: function () {
            if(!this.el) {
                var attrs = _.extend({}, _.result(this, 'attributes'));
                if(this.id) attrs.id = _.result(this, 'id');
                if(this.className) attrs['class'] = _.result(this, 'className');
                this.setElement(this._createElement(_.result(this, 'tagName')));
                this._setAttributes(attrs);
            } else {
                this.setElement(_.result(this, 'el'));
            }
        },

        // set attr from a hash on this views el
        _setAttributes: function (attributes) {
            this.$el.attr(attributes);
        }

    });


    // Backbone.sync
    // -------------

    // override this function if needed
    // by def, makes a RESTful Ajax req to the models url()
    // possible customizations:
    //  use 'setTimeout' to batch radid-fire updates into a single req
    //  send up the models as XML instead of JSON
    //  persist models via WebSockets instead of Ajax
    //
    // turn on Backbone.emulateHTTP in order to send PUT and DELETE reqs
    // as POST, with a _method param containing the true HTTP method,
    // as well as all reqs with the body as `application/x-www-form-urlencoded`
    // instead of `application/json` with the model in a param named `model`
    // useful when interfacing with server-side langs like PHP
    // that make it difficult to read the body of PUT reqs
    Backbone.sync = function (method, model, options) {
        var type = methodMap[method];

        _.defaults(options || (options = {}), {
            emulateHTTP: Backbone.emulateHTTP,
            emulateJSON: Backbone.emulateJSON
        });

        var params = {type: type, dataType: 'json'};

        // ensure that we have URL
        if(!options.url) {
            params.url = _.result(model, 'url') || urlError();
        }

        // ensure that we have appropriate req data
        if(options.data == null && model && (method === 'create' || method === 'update' || method === 'patch')){
            params.contentType = 'application/json';
            params.data = JSON.stringify(options.attrs || model.toJSON(options));
        }

        // for older servers, emulate JSON by encodeing the req into a HTML-form
        if(options.emulateJSON) {
            params.contentType = 'application/x-www-form-urlencoded';
            params.data = params.data ? {model: params.data} : {};
        }

        // for older servers, emulate HTTP by mimicking the HTTP method with '_method'
        // and an 'X-HTTP-Method-Override' header
        if(options.emulateHTTP && (type === 'PUT' || type === 'DELETE' || type === 'PATCH')){
            params.type = 'POST';
            if(options.emulateJSON) params.data._method = type;
            var beforeSend = options.beforeSend;
            options.beforeSend = function (xhr) {
                xhr.setRequestHeader('X-HTTP-Method-Override', type);
                if(beforeSend) return beforeSend.apply(this, arguments);
            };
        }

        // dont process data on a non-GET req
        if(params.type !== 'GET' && !options.emulateJSON){
            params.processData = false;
        }

        // pass along 'textStatus' and 'errorThrown' from jQuery
        var error = options.error;
        options.error = function (xhr, textStatus, errorThrown) {
            options.textStatus = textStatus;
            options.errorThrown = errorThrown;
            if(error) error.call(options.context, xhr, textStatus, errorThrown);
        };

        // make the req, allowing the user to override any Ajax opts
        var xhr = options.xhr = Backbone.ajax(_extend(params, options));
        model.trigger('request', model, xhr, options);
        return xhr;
    };

    // map from CRUD to HTTP for our default 'Backbone.sync' implementation
    var methodMap = {
        'create' : 'POST',
        'update' : 'PUT',
        'patch'  : 'PATCH',
        'delete' : 'DELETE',
        'read'   : 'GET'
    };

    // set def Backbone.ajax to proxy through to $
    Backbone.ajax = function () {
        return Backbone.$.ajax.apply(Backbone.$, arguments);
    };

    // Backbone.Router
    // ---------------

    // Routes map faux-URLs to actions, and fire events when routes are
    // matched. Creating a new one sets its `routes` hash, if not set statically.
    var Router = Backbone.Router = function (options) {
        options || (options = {});
        this.preinitialize.apply(this, arguments);
        if(options.routes) this.routes = options.routes;
        this._bindRoutes();
        this.initialize.apply(this, arguments);
    };


    // cached regexes for matching named param parts and splatted parts of route string
    var OptionalParam = /\((.*?)\)/g;
    var namedParam = /(\(\?)?:\w+/g;
    var splatParam = /\*\w+/g;
    var escapeRegExp = /[\-{}\[\]+?.,\\\^$|#\s]/g;

    // set up all methods
    _.extend(Router.prototype, Events, {
        preinitialize: function () {

        },
        initialize: function () {

        },

        // manually bind a single named route to a callback. Example:
        //
        //      this.route('search/:query/p:num', 'search', function(query, num) {
        //          ...
        //      }
        //
        route: function (route, name, callback) {
            if(!_.isRegExp(route)) route = this._routeToRegExp(route);
            if(_.isFunction(name)) {
                callback = name;
                name = '';
            }
            if(!callback) callback = this[name];
            var router = this;
            Backbone.history.route(route, function (fragment) {
                var args = router._extractParameters(route, fragment);
                if(router.execute(callback, args, name) !== false) {
                    router.trigger.apply(router, ['route:' + name].concat(args));
                    router.trigger('route', router, name, args);
                    Backbone.history.trigger('route', router, name, args);
                }
            });
            return this;
        },

        // execute a route handler with the provided params
        // here it is possible to place pre-route setup or post-route cleanup
        execute: function (callback, args, name) {
            if(callback) callback.apply(this, args);
        },

        // simple proxy to `backbone.history` to sava a fragment into the history
        navigate: function (fragment, options) {
            Backbone.history.navigate(fragment, options);
            return this;
        },

        // bind all def routes to `Backbone.history`
        // we have to reverse the order of the routes here to support behavior
        // where the most general routes can be defined at the bottom of the route map
        _bindRoutes: function () {
            if(!this.routes) return;
            this.routes = _.result(this, 'routes');
            var route, routes = _.keys(this.routes);
            while((route = routes.pop()) !== null) {
                this.route(route, this.routes[route]);
            }
        },

        // convert a route string into a regexp, suitable for matching
        // against current location hash
        _routeToRegExp: function (route) {
            route = route.replace(escapeRegExp, '\\$&')
                    .replace(optionalParam, '(?:$1)?')
                    .replace(namedParam, function (match, optional) {
                        return optional ? match : '([^/?]+)';
                    })
                    .replace(splatParam, '([^?]*?)');
            return new RegExp('^' + route + '(?:\\?([\\s\\S]*))?$');
        },

        // given a route, and a URl fragment that it matches, return
        // the array of extracted decoded params. Empty or unmatched params will be
        // treated as `null` to normalize cross-browser behavior
        _extractParameters: function (route, fragment) {
            var params = route.exec(fragment).slice(1);
            return _.map(params, function (param, i) {
                // dont decode search params
                if(i=== params.length-1) return param || null;
                return param ? decodeURIComponent(param) : null;
            });
        }
    });

    // backbone History

    // handles cross-browser history managment
    // based on pushstate and real urls, or
    // onhashchange and url fragms
    // if brower support neither, falls back to polling
    var History = Backbone.History = function () {
        this.handlers = [];
        this.checkUrl = _.bind(this.checkUrl, this);

        // ensure that history can be used outside the browser
        if(typeof  window !== 'undefined') {
            this.location = window.location;
            this.history = window.history;
        }
    };

    // cached regexp for stripping a leading hash/slash and trailing space
    var reouteStripper = /^[#\/]|s+$/g;

    // cached regexp for stripping leading and trailing slashes
    var rootStripper = /^\/+|\/+$/g;

    // cached regexp for stripping urls of hash
    var pathStripper = /#.*$/;

    History.started = false;

    // set up all inheritable methods
    _.extend(History.prototype, Events, {

        // the def interval to poll for hash changes
        // if necessary, its 20 times per second
        interval: 50,

        atRoot: function () {
            var path = this.location.pathname.replace(/[^\/]$/, '$&/');
            return path === this.root && !this.getSearch();
        },

        // does the pathname mathes root?
        matchRoot: function () {
            var path = this.decodeFragment(this.location.pathname);
            var rootPath = path.slice(0, this.root.length - 1) + '/';
            return rootPath === this.root;
        },

        // unicode chars in location pathname are percent encoded
        // %25 should not be decoded (it may be a part of encoded param
        decodeFragment: function (fragment) {
            return decodeURI(fragment.replace(/%25/g, '%2525'));
        },

        // in IE6, the hash fragment and search params are incorrect if the fragment contaions '?'
        getSearch: function () {
            var match = this.locatoin.href.replace(/#.*/, '').match(/\?.+/);
            return match ? match[0] : '';
        },

        // gets the true hash value
        // cant use location.hash due to bug in firefox where location.hash will always be decoded
        getHash: function (window) {
            var match = (window || this).location.href.match(/#(.*)$/);
            return match ? match[1] : '';
        },

        // get the pathname and search params, without the root
        getPath: function () {
            var path = this.decodeFragment(
                    this.location.pathname + this.getSearch()
            ).slice(this.root.length - 1);
            return path.charAt(0) === '/' ? path.slice(1): path;
        },

        // get the cross-browser normalized url fragment from the path or hash
        getFragment: function (fragment) {
            if(fragment == null) {
                if(this._usePushState || !this._wantsHashChange) {
                    fragment = this.getPath();
                } else {
                    fragment = this.getHash();
                }
            }
            return fragment.replace(rootStripper, '');
        },

        // start the hash change handling
        // ret true if cur url matches an existing route
        start: function (options) {
            if(History.started) throw new Error('Backbone.history has already been started');
            History.started = true;

            // figure out the initial config. Do we need an iframe?
            // is pushstate desired ... is it available
            this.options = _.extend({root: '/'}, this.options, options);
            this.root = this.options.root;
            this._wantsHashChange = this.options.hashChange !== false;
            this._hasHashChange = 'onhashchange' in window && (document.documentMode === void 0 || document.documentMode > 7);
            this._useHashChange = this._wantsHashChange && this._hasHashChange;
            this._wantsPushState = !!this.options.pushState;
            this._hasPushState = !!(this.history && this.history.pushState);
            this._usePushState = this._wantsPushState && this.hasPushState;
            this.fragment = this.getFragment();

            // normalize root to always include a leading and trailing slash
            this.root = ('/' + this.root + '/').replace(rootStripper, '/');

            // transition from hashChange to pushState or vise versa if both are requested
            if(this._wantsHashChange && this._wantsPushState) {
                // if we started off with a route from a pushState-enabled browser
                // but we are currently in a browser that doesnt support it..
                if(!this._hasPushState && !this.atRoot()) {
                    var rootPath = this.root.slice(0, 1) || '/';
                    this.location.replace(rootPath + '#' + this.getPath());
                    // return immediately as  browser will do redirect to new url
                    return true;

                // could be pushState
                } else if(this._hasPushState && this.atRoot()) {
                    this.navigate(this.getHash(), {replace: true});
                }
            }

            // proxy an iframe to handle location events if the browser doesn't
            // support the 'hashchange' event, html5 history, or the user wants
            // 'hashChange' but not 'pushState'
            if(!this._hasHashChange && this._wantsHashChange && !this._usePushState){
                this.iframe = document.createElement('iframe');
                this.iframe.src = 'javascript:0';
                this.iframe.style.display = 'none';
                this.iframe.tabIndex = -1;
                var body = document.body;

                // using 'appendChild' will throw on IE<9 if the document is not ready
                var iWindow = body.insertBefore(this.iframe, body.fistChild).contentWindow;
                iWindow.document.open();
                iWindow.document.close();
                iWindow.location.hash = '#' + this.fragment;
            }

            // add a cross-platform 'addEventListener' shim for older browsers
            var addEventListener = window.addEventListener || function (eventName, listener) {
                        return attachEvent('on' + eventName, listener);
                    };

            // depending on whether we are using pushState or hashes, and whether
            // 'onhashchange' is supported, determine how we check the url state
            if(this._usePushState){
                addEventListener('popstate', this.checkUrl, false);
            } else if(this._useHashChange && !this.iframe){
                addEventListener('hashchange', this.checkUrl, false);
            } else if(this._wantsHashChange) {
                this._checkUrlInterval = setInterval(this.checkUrl, this.interval);
            }

            if(!this.options.silent) return this.loadUrl();
        },

        // disable Backbone.history, perhaps temporarily
        // not useful on real app, useful for unit testing routers
        stop: function () {
            var removeEventListener = window.removeEventListener || function (eventName, listener) {
                        return detachEvent('on' + eventName, listener);
                    };

            // remove window listeners
            if(this._usePushState) {
                removeEventListener('popstate', this.checkUrl, false);
            } else if(this._useHashChange && !this.iframe) {
                removeEventListener('hashchange', this.checkUrl, false);
            }

            // clean up iframe if necessary
            if(this.iframe){
                document.body.removeChild(this.iframe);
                this.iframe = null;
            }

            // some envs will throw when clearing an undef interval
            if(this._checkUrlInterval) clearInterval(this._checkUrlIntrval);
            History.started = false;
        },

        // add a route to be tested when the fragment changes
        // routes added later may override prev routes
        route: function (route, callback) {
            this.handlers.unshift({route: route, callback: callback});
        },

        // checks the current url to see if it has changed,
        // if changed - calls 'loadURL', normalizing across the hidden iframe
        checkUrl: function (e) {
            var current = this.getFragment();

            // if user pressed back btn
            // the iframe's hash will have changed
            // and we should use it for comparison
            if(current === this.fragment) return false;
            if(this.iframe) this.navigate(current);
            this.loadUrl();
        },

        // attempt to load url fragment
        // if succeeds, ret true
        loadUrl: function(fragment) {
            // if root match
            if(!this.matchRoot()) return false;
            fragment = this.fragment = this.getFragment(fragment);
            return _.some(this.handlers, function (handler) {
                if(handler.route.test(fragment)) {
                    handler.callback(fragment);
                    return true;
                }
            });
        },

        // save a fragment into the hash history, or replace the url state if the
        // 'replace' option is passed. u r responsible for properly url-encoding the fragment in advance
        // the options obj can contain 'trigger: true' if u wish to have the route callbackbe fired
        // or 'replace: true' if u wish to modify current url without adding to the history
        navigate: function (fragment, options) {
            if(!History.started) return false;
            if(!options || options === true) options = {trigger: !!options};

            // normalize the fragment
            fragment = this.getFragment(fragment || '');

            // dont include trailing slash on the root
            var rootPath = this.root;
            if(fragment ==='' || fragment.charAt(0) === '?') {
                rootPath = rootPath.slice(0, -1) || '/';
            }
            var url = rootPath + fragment;

            // strip the fragment of the query and hash for matching
            fragment = fragment.replace(pathStripper, '');

            // decode for matching
            var decodedFragment = this.decodeFragment(fragment);

            if(this.fragment === decodedFragment) return;
            this.fragment = decodedFragment;

            // if pushState is available, we use it to set the fragment as a real URL
            if(this._usePushState) {
                this.history[options.replace ? 'replaceState' : 'pushState']({}, document.title, url);

            // if hash changes havent been disabled, update the hash fragment to store history
            } else if(this._wantsHashChange) {
                this._updateHash(this.location, fragment, options.replace);
                if(this.iframe && fragment !== this.getHash(this.iframe.contentWindow)) {
                    var iWindow = this.iframe.contentWindow;

                    // <= IE7
                    if(!options.replace) {
                        iWindow.document.open();
                        iWindow.document.close();
                    }

                    this._updateHash(iWindow.location, fragment, options.replace);
                }

            // if dont want fallback hashchange-based history => navigate becomes a page refresh
            } else {
                return this.location.assign(url);
            }
            if(options.trigger) return this.loadUrl(fragment);
        },

        // update hash location, either replacing the current entry
        // or adding a new one to the browser history
        _updateHash: function (location, fragment, replace) {
            if(replace) {
                var href = location.href.replace(/(javascript:|#).*$/, '');
                location.replace(href + '#' + fragment);
            } else {
                // some browsers require that 'hash' contains a leading #
                location.hash = '#'+fragment;
            }
        }
    });

    // create the def Backbone.history
    Backbone.history = new History;

    // Helpers
    // --------------

    // correctly set up prototype chain for subclasses
    var extend = function (protoProps, staticProps) {
        var parent = this,
                child;

        // the constructor function for the new subclass is either defined
        // by you or defaulted by us
        if(protoProps && _.has(protoProps, 'construstor')){
            child = protoProps.constructor;
        } else {
            child = function () {
                return parent.apply(this, arguments);
            };
        }

        _.extend(child, parent, staticProps);

        child.prototype = _.create(parent.prototype, protoProps);
        child.prototype.constructor = child;

        child.__super__ = parent.prototype;

        return child;
    };

    // set up inheritance for the model, collection, router, view and history
    Model.extend = Collection.extend = Router.extend = View.extend = History.extend = extend;

    var urlError = function () {
        throw new Error('url must be specified');
    };

    var wrapError = function (model, options) {
        var error = options.error;
        options.error = function (reps) {
            if(error) error.call(options.context, model, resp, options);
            model.trigger('error', model, resp, options);
        };
    };

    return Backbone;
});

