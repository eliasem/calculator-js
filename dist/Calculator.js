(function (root, factory) {
    if(typeof define === 'function' && define.amd) {
        // AMD.
        define(['jquery'], factory);
    } else {
        // Browser globals
        root.Calculator = factory(root.$);
    }
}(this, function($) {/**
 * @license almond 0.3.2 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, http://github.com/requirejs/almond/LICENSE
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part, normalizedBaseParts,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name) {
            name = name.split('/');
            lastIndex = name.length - 1;

            // If wanting node ID compatibility, strip .js from end
            // of IDs. Have to do this here, and not in nameToUrl
            // because node allows either .js or non .js to map
            // to same file.
            if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
            }

            // Starts with a '.' so need the baseName
            if (name[0].charAt(0) === '.' && baseParts) {
                //Convert baseName to array, and lop off the last part,
                //so that . matches that 'directory' and not name of the baseName's
                //module. For instance, baseName of 'one/two/three', maps to
                //'one/two/three.js', but we want the directory, 'one/two' for
                //this normalization.
                normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                name = normalizedBaseParts.concat(name);
            }

            //start trimDots
            for (i = 0; i < name.length; i++) {
                part = name[i];
                if (part === '.') {
                    name.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    // If at the start, or previous value is still ..,
                    // keep them so that when converted to a path it may
                    // still work when converted to a path, even though
                    // as an ID it is less than ideal. In larger point
                    // releases, may be better to just kick out an error.
                    if (i === 0 || (i === 1 && name[2] === '..') || name[i - 1] === '..') {
                        continue;
                    } else if (i > 0) {
                        name.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
            //end trimDots

            name = name.join('/');
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../../../bower_components/almond/almond", function(){});

/*!
 * jQuery JavaScript Library v2.2.3
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright jQuery Foundation and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2016-04-05T19:26Z
 */

(function( global, factory ) {

	if ( typeof module === "object" && typeof module.exports === "object" ) {
		// For CommonJS and CommonJS-like environments where a proper `window`
		// is present, execute the factory and get jQuery.
		// For environments that do not have a `window` with a `document`
		// (such as Node.js), expose a factory as module.exports.
		// This accentuates the need for the creation of a real `window`.
		// e.g. var jQuery = require("jquery")(window);
		// See ticket #14549 for more info.
		module.exports = global.document ?
			factory( global, true ) :
			function( w ) {
				if ( !w.document ) {
					throw new Error( "jQuery requires a window with a document" );
				}
				return factory( w );
			};
	} else {
		factory( global );
	}

// Pass this if window is not defined yet
}(typeof window !== "undefined" ? window : this, function( window, noGlobal ) {

// Support: Firefox 18+
// Can't be in strict mode, several libs including ASP.NET trace
// the stack via arguments.caller.callee and Firefox dies if
// you try to trace through "use strict" call chains. (#13335)
//"use strict";
var arr = [];

var document = window.document;

var slice = arr.slice;

var concat = arr.concat;

var push = arr.push;

var indexOf = arr.indexOf;

var class2type = {};

var toString = class2type.toString;

var hasOwn = class2type.hasOwnProperty;

var support = {};



var
	version = "2.2.3",

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {

		// The jQuery object is actually just the init constructor 'enhanced'
		// Need init if jQuery is called (just allow error to be thrown if not included)
		return new jQuery.fn.init( selector, context );
	},

	// Support: Android<4.1
	// Make sure we trim BOM and NBSP
	rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return letter.toUpperCase();
	};

jQuery.fn = jQuery.prototype = {

	// The current version of jQuery being used
	jquery: version,

	constructor: jQuery,

	// Start with an empty selector
	selector: "",

	// The default length of a jQuery object is 0
	length: 0,

	toArray: function() {
		return slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num != null ?

			// Return just the one element from the set
			( num < 0 ? this[ num + this.length ] : this[ num ] ) :

			// Return all the elements in a clean array
			slice.call( this );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;
		ret.context = this.context;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	each: function( callback ) {
		return jQuery.each( this, callback );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map( this, function( elem, i ) {
			return callback.call( elem, i, elem );
		} ) );
	},

	slice: function() {
		return this.pushStack( slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[ j ] ] : [] );
	},

	end: function() {
		return this.prevObject || this.constructor();
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: push,
	sort: arr.sort,
	splice: arr.splice
};

jQuery.extend = jQuery.fn.extend = function() {
	var options, name, src, copy, copyIsArray, clone,
		target = arguments[ 0 ] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;

		// Skip the boolean and the target
		target = arguments[ i ] || {};
		i++;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction( target ) ) {
		target = {};
	}

	// Extend jQuery itself if only one argument is passed
	if ( i === length ) {
		target = this;
		i--;
	}

	for ( ; i < length; i++ ) {

		// Only deal with non-null/undefined values
		if ( ( options = arguments[ i ] ) != null ) {

			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject( copy ) ||
					( copyIsArray = jQuery.isArray( copy ) ) ) ) {

					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray( src ) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject( src ) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend( {

	// Unique for each copy of jQuery on the page
	expando: "jQuery" + ( version + Math.random() ).replace( /\D/g, "" ),

	// Assume jQuery is ready without the ready module
	isReady: true,

	error: function( msg ) {
		throw new Error( msg );
	},

	noop: function() {},

	isFunction: function( obj ) {
		return jQuery.type( obj ) === "function";
	},

	isArray: Array.isArray,

	isWindow: function( obj ) {
		return obj != null && obj === obj.window;
	},

	isNumeric: function( obj ) {

		// parseFloat NaNs numeric-cast false positives (null|true|false|"")
		// ...but misinterprets leading-number strings, particularly hex literals ("0x...")
		// subtraction forces infinities to NaN
		// adding 1 corrects loss of precision from parseFloat (#15100)
		var realStringObj = obj && obj.toString();
		return !jQuery.isArray( obj ) && ( realStringObj - parseFloat( realStringObj ) + 1 ) >= 0;
	},

	isPlainObject: function( obj ) {
		var key;

		// Not plain objects:
		// - Any object or value whose internal [[Class]] property is not "[object Object]"
		// - DOM nodes
		// - window
		if ( jQuery.type( obj ) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		// Not own constructor property must be Object
		if ( obj.constructor &&
				!hasOwn.call( obj, "constructor" ) &&
				!hasOwn.call( obj.constructor.prototype || {}, "isPrototypeOf" ) ) {
			return false;
		}

		// Own properties are enumerated firstly, so to speed up,
		// if last one is own, then all properties are own
		for ( key in obj ) {}

		return key === undefined || hasOwn.call( obj, key );
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	type: function( obj ) {
		if ( obj == null ) {
			return obj + "";
		}

		// Support: Android<4.0, iOS<6 (functionish RegExp)
		return typeof obj === "object" || typeof obj === "function" ?
			class2type[ toString.call( obj ) ] || "object" :
			typeof obj;
	},

	// Evaluates a script in a global context
	globalEval: function( code ) {
		var script,
			indirect = eval;

		code = jQuery.trim( code );

		if ( code ) {

			// If the code includes a valid, prologue position
			// strict mode pragma, execute code by injecting a
			// script tag into the document.
			if ( code.indexOf( "use strict" ) === 1 ) {
				script = document.createElement( "script" );
				script.text = code;
				document.head.appendChild( script ).parentNode.removeChild( script );
			} else {

				// Otherwise, avoid the DOM node creation, insertion
				// and removal by using an indirect global eval

				indirect( code );
			}
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Support: IE9-11+
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	each: function( obj, callback ) {
		var length, i = 0;

		if ( isArrayLike( obj ) ) {
			length = obj.length;
			for ( ; i < length; i++ ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		} else {
			for ( i in obj ) {
				if ( callback.call( obj[ i ], i, obj[ i ] ) === false ) {
					break;
				}
			}
		}

		return obj;
	},

	// Support: Android<4.1
	trim: function( text ) {
		return text == null ?
			"" :
			( text + "" ).replace( rtrim, "" );
	},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArrayLike( Object( arr ) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		return arr == null ? -1 : indexOf.call( arr, elem, i );
	},

	merge: function( first, second ) {
		var len = +second.length,
			j = 0,
			i = first.length;

		for ( ; j < len; j++ ) {
			first[ i++ ] = second[ j ];
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, invert ) {
		var callbackInverse,
			matches = [],
			i = 0,
			length = elems.length,
			callbackExpect = !invert;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			callbackInverse = !callback( elems[ i ], i );
			if ( callbackInverse !== callbackExpect ) {
				matches.push( elems[ i ] );
			}
		}

		return matches;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var length, value,
			i = 0,
			ret = [];

		// Go through the array, translating each of the items to their new values
		if ( isArrayLike( elems ) ) {
			length = elems.length;
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret.push( value );
				}
			}
		}

		// Flatten any nested arrays
		return concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var tmp, args, proxy;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context || this, args.concat( slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	now: Date.now,

	// jQuery.support is not used in Core but other projects attach their
	// properties to it so it needs to exist.
	support: support
} );

// JSHint would error on this code due to the Symbol not being defined in ES5.
// Defining this global in .jshintrc would create a danger of using the global
// unguarded in another place, it seems safer to just disable JSHint for these
// three lines.
/* jshint ignore: start */
if ( typeof Symbol === "function" ) {
	jQuery.fn[ Symbol.iterator ] = arr[ Symbol.iterator ];
}
/* jshint ignore: end */

// Populate the class2type map
jQuery.each( "Boolean Number String Function Array Date RegExp Object Error Symbol".split( " " ),
function( i, name ) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
} );

function isArrayLike( obj ) {

	// Support: iOS 8.2 (not reproducible in simulator)
	// `in` check used to prevent JIT error (gh-2145)
	// hasOwn isn't used here due to false negatives
	// regarding Nodelist length in IE
	var length = !!obj && "length" in obj && obj.length,
		type = jQuery.type( obj );

	if ( type === "function" || jQuery.isWindow( obj ) ) {
		return false;
	}

	return type === "array" || length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj;
}
var Sizzle =
/*!
 * Sizzle CSS Selector Engine v2.2.1
 * http://sizzlejs.com/
 *
 * Copyright jQuery Foundation and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2015-10-17
 */
(function( window ) {

var i,
	support,
	Expr,
	getText,
	isXML,
	tokenize,
	compile,
	select,
	outermostContext,
	sortInput,
	hasDuplicate,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsHTML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,

	// Instance-specific data
	expando = "sizzle" + 1 * new Date(),
	preferredDoc = window.document,
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),
	sortOrder = function( a, b ) {
		if ( a === b ) {
			hasDuplicate = true;
		}
		return 0;
	},

	// General-purpose constants
	MAX_NEGATIVE = 1 << 31,

	// Instance methods
	hasOwn = ({}).hasOwnProperty,
	arr = [],
	pop = arr.pop,
	push_native = arr.push,
	push = arr.push,
	slice = arr.slice,
	// Use a stripped-down indexOf as it's faster than native
	// http://jsperf.com/thor-indexof-vs-for/5
	indexOf = function( list, elem ) {
		var i = 0,
			len = list.length;
		for ( ; i < len; i++ ) {
			if ( list[i] === elem ) {
				return i;
			}
		}
		return -1;
	},

	booleans = "checked|selected|async|autofocus|autoplay|controls|defer|disabled|hidden|ismap|loop|multiple|open|readonly|required|scoped",

	// Regular expressions

	// http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",

	// http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

	// Attribute selectors: http://www.w3.org/TR/selectors/#attribute-selectors
	attributes = "\\[" + whitespace + "*(" + identifier + ")(?:" + whitespace +
		// Operator (capture 2)
		"*([*^$|!~]?=)" + whitespace +
		// "Attribute values must be CSS identifiers [capture 5] or strings [capture 3 or capture 4]"
		"*(?:'((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\"|(" + identifier + "))|)" + whitespace +
		"*\\]",

	pseudos = ":(" + identifier + ")(?:\\((" +
		// To reduce the number of selectors needing tokenize in the preFilter, prefer arguments:
		// 1. quoted (capture 3; capture 4 or capture 5)
		"('((?:\\\\.|[^\\\\'])*)'|\"((?:\\\\.|[^\\\\\"])*)\")|" +
		// 2. simple (capture 6)
		"((?:\\\\.|[^\\\\()[\\]]|" + attributes + ")*)|" +
		// 3. anything else (capture 2)
		".*" +
		")\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rwhitespace = new RegExp( whitespace + "+", "g" ),
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([>+~]|" + whitespace + ")" + whitespace + "*" ),

	rattributeQuotes = new RegExp( "=" + whitespace + "*([^\\]'\"]*?)" + whitespace + "*\\]", "g" ),

	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + identifier + ")" ),
		"CLASS": new RegExp( "^\\.(" + identifier + ")" ),
		"TAG": new RegExp( "^(" + identifier + "|[*])" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		"bool": new RegExp( "^(?:" + booleans + ")$", "i" ),
		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
			whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rnative = /^[^{]+\{\s*\[native \w/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rsibling = /[+~]/,
	rescape = /'|\\/g,

	// CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = new RegExp( "\\\\([\\da-f]{1,6}" + whitespace + "?|(" + whitespace + ")|.)", "ig" ),
	funescape = function( _, escaped, escapedWhitespace ) {
		var high = "0x" + escaped - 0x10000;
		// NaN means non-codepoint
		// Support: Firefox<24
		// Workaround erroneous numeric interpretation of +"0x"
		return high !== high || escapedWhitespace ?
			escaped :
			high < 0 ?
				// BMP codepoint
				String.fromCharCode( high + 0x10000 ) :
				// Supplemental Plane codepoint (surrogate pair)
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	},

	// Used for iframes
	// See setDocument()
	// Removing the function wrapper causes a "Permission Denied"
	// error in IE
	unloadHandler = function() {
		setDocument();
	};

// Optimize for push.apply( _, NodeList )
try {
	push.apply(
		(arr = slice.call( preferredDoc.childNodes )),
		preferredDoc.childNodes
	);
	// Support: Android<4.0
	// Detect silently failing push.apply
	arr[ preferredDoc.childNodes.length ].nodeType;
} catch ( e ) {
	push = { apply: arr.length ?

		// Leverage slice if possible
		function( target, els ) {
			push_native.apply( target, slice.call(els) );
		} :

		// Support: IE<9
		// Otherwise append directly
		function( target, els ) {
			var j = target.length,
				i = 0;
			// Can't trust NodeList.length
			while ( (target[j++] = els[i++]) ) {}
			target.length = j - 1;
		}
	};
}

function Sizzle( selector, context, results, seed ) {
	var m, i, elem, nid, nidselect, match, groups, newSelector,
		newContext = context && context.ownerDocument,

		// nodeType defaults to 9, since context defaults to document
		nodeType = context ? context.nodeType : 9;

	results = results || [];

	// Return early from calls with invalid selector or context
	if ( typeof selector !== "string" || !selector ||
		nodeType !== 1 && nodeType !== 9 && nodeType !== 11 ) {

		return results;
	}

	// Try to shortcut find operations (as opposed to filters) in HTML documents
	if ( !seed ) {

		if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
			setDocument( context );
		}
		context = context || document;

		if ( documentIsHTML ) {

			// If the selector is sufficiently simple, try using a "get*By*" DOM method
			// (excepting DocumentFragment context, where the methods don't exist)
			if ( nodeType !== 11 && (match = rquickExpr.exec( selector )) ) {

				// ID selector
				if ( (m = match[1]) ) {

					// Document context
					if ( nodeType === 9 ) {
						if ( (elem = context.getElementById( m )) ) {

							// Support: IE, Opera, Webkit
							// TODO: identify versions
							// getElementById can match elements by name instead of ID
							if ( elem.id === m ) {
								results.push( elem );
								return results;
							}
						} else {
							return results;
						}

					// Element context
					} else {

						// Support: IE, Opera, Webkit
						// TODO: identify versions
						// getElementById can match elements by name instead of ID
						if ( newContext && (elem = newContext.getElementById( m )) &&
							contains( context, elem ) &&
							elem.id === m ) {

							results.push( elem );
							return results;
						}
					}

				// Type selector
				} else if ( match[2] ) {
					push.apply( results, context.getElementsByTagName( selector ) );
					return results;

				// Class selector
				} else if ( (m = match[3]) && support.getElementsByClassName &&
					context.getElementsByClassName ) {

					push.apply( results, context.getElementsByClassName( m ) );
					return results;
				}
			}

			// Take advantage of querySelectorAll
			if ( support.qsa &&
				!compilerCache[ selector + " " ] &&
				(!rbuggyQSA || !rbuggyQSA.test( selector )) ) {

				if ( nodeType !== 1 ) {
					newContext = context;
					newSelector = selector;

				// qSA looks outside Element context, which is not what we want
				// Thanks to Andrew Dupont for this workaround technique
				// Support: IE <=8
				// Exclude object elements
				} else if ( context.nodeName.toLowerCase() !== "object" ) {

					// Capture the context ID, setting it first if necessary
					if ( (nid = context.getAttribute( "id" )) ) {
						nid = nid.replace( rescape, "\\$&" );
					} else {
						context.setAttribute( "id", (nid = expando) );
					}

					// Prefix every selector in the list
					groups = tokenize( selector );
					i = groups.length;
					nidselect = ridentifier.test( nid ) ? "#" + nid : "[id='" + nid + "']";
					while ( i-- ) {
						groups[i] = nidselect + " " + toSelector( groups[i] );
					}
					newSelector = groups.join( "," );

					// Expand context for sibling selectors
					newContext = rsibling.test( selector ) && testContext( context.parentNode ) ||
						context;
				}

				if ( newSelector ) {
					try {
						push.apply( results,
							newContext.querySelectorAll( newSelector )
						);
						return results;
					} catch ( qsaError ) {
					} finally {
						if ( nid === expando ) {
							context.removeAttribute( "id" );
						}
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Create key-value caches of limited size
 * @returns {function(string, object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var keys = [];

	function cache( key, value ) {
		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key + " " ) > Expr.cacheLength ) {
			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return (cache[ key + " " ] = value);
	}
	return cache;
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created div and expects a boolean result
 */
function assert( fn ) {
	var div = document.createElement("div");

	try {
		return !!fn( div );
	} catch (e) {
		return false;
	} finally {
		// Remove from its parent by default
		if ( div.parentNode ) {
			div.parentNode.removeChild( div );
		}
		// release memory in IE
		div = null;
	}
}

/**
 * Adds the same handler for all of the specified attrs
 * @param {String} attrs Pipe-separated list of attributes
 * @param {Function} handler The method that will be applied
 */
function addHandle( attrs, handler ) {
	var arr = attrs.split("|"),
		i = arr.length;

	while ( i-- ) {
		Expr.attrHandle[ arr[i] ] = handler;
	}
}

/**
 * Checks document order of two siblings
 * @param {Element} a
 * @param {Element} b
 * @returns {Number} Returns less than 0 if a precedes b, greater than 0 if a follows b
 */
function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && a.nodeType === 1 && b.nodeType === 1 &&
			( ~b.sourceIndex || MAX_NEGATIVE ) -
			( ~a.sourceIndex || MAX_NEGATIVE );

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( (cur = cur.nextSibling) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

/**
 * Returns a function to use in pseudos for input types
 * @param {String} type
 */
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for buttons
 * @param {String} type
 */
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

/**
 * Returns a function to use in pseudos for positionals
 * @param {Function} fn
 */
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Checks a node for validity as a Sizzle context
 * @param {Element|Object=} context
 * @returns {Element|Object|Boolean} The input node if acceptable, otherwise a falsy value
 */
function testContext( context ) {
	return context && typeof context.getElementsByTagName !== "undefined" && context;
}

// Expose support vars for convenience
support = Sizzle.support = {};

/**
 * Detects XML nodes
 * @param {Element|Object} elem An element or a document
 * @returns {Boolean} True iff elem is a non-HTML XML node
 */
isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var hasCompare, parent,
		doc = node ? node.ownerDocument || node : preferredDoc;

	// Return early if doc is invalid or already selected
	if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Update global variables
	document = doc;
	docElem = document.documentElement;
	documentIsHTML = !isXML( document );

	// Support: IE 9-11, Edge
	// Accessing iframe documents after unload throws "permission denied" errors (jQuery #13936)
	if ( (parent = document.defaultView) && parent.top !== parent ) {
		// Support: IE 11
		if ( parent.addEventListener ) {
			parent.addEventListener( "unload", unloadHandler, false );

		// Support: IE 9 - 10 only
		} else if ( parent.attachEvent ) {
			parent.attachEvent( "onunload", unloadHandler );
		}
	}

	/* Attributes
	---------------------------------------------------------------------- */

	// Support: IE<8
	// Verify that getAttribute really returns attributes and not properties
	// (excepting IE8 booleans)
	support.attributes = assert(function( div ) {
		div.className = "i";
		return !div.getAttribute("className");
	});

	/* getElement(s)By*
	---------------------------------------------------------------------- */

	// Check if getElementsByTagName("*") returns only elements
	support.getElementsByTagName = assert(function( div ) {
		div.appendChild( document.createComment("") );
		return !div.getElementsByTagName("*").length;
	});

	// Support: IE<9
	support.getElementsByClassName = rnative.test( document.getElementsByClassName );

	// Support: IE<10
	// Check if getElementById returns elements by name
	// The broken getElementById methods don't pick up programatically-set names,
	// so use a roundabout getElementsByName test
	support.getById = assert(function( div ) {
		docElem.appendChild( div ).id = expando;
		return !document.getElementsByName || !document.getElementsByName( expando ).length;
	});

	// ID find and filter
	if ( support.getById ) {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== "undefined" && documentIsHTML ) {
				var m = context.getElementById( id );
				return m ? [ m ] : [];
			}
		};
		Expr.filter["ID"] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute("id") === attrId;
			};
		};
	} else {
		// Support: IE6/7
		// getElementById is not reliable as a find shortcut
		delete Expr.find["ID"];

		Expr.filter["ID"] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== "undefined" &&
					elem.getAttributeNode("id");
				return node && node.value === attrId;
			};
		};
	}

	// Tag
	Expr.find["TAG"] = support.getElementsByTagName ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== "undefined" ) {
				return context.getElementsByTagName( tag );

			// DocumentFragment nodes don't have gEBTN
			} else if ( support.qsa ) {
				return context.querySelectorAll( tag );
			}
		} :

		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,
				// By happy coincidence, a (broken) gEBTN appears on DocumentFragment nodes too
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( (elem = results[i++]) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Class
	Expr.find["CLASS"] = support.getElementsByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== "undefined" && documentIsHTML ) {
			return context.getElementsByClassName( className );
		}
	};

	/* QSA/matchesSelector
	---------------------------------------------------------------------- */

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21)
	// We allow this because of a bug in IE8/9 that throws an error
	// whenever `document.activeElement` is accessed on an iframe
	// So, we allow :focus to pass through QSA all the time to avoid the IE error
	// See http://bugs.jquery.com/ticket/13378
	rbuggyQSA = [];

	if ( (support.qsa = rnative.test( document.querySelectorAll )) ) {
		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explicitly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			docElem.appendChild( div ).innerHTML = "<a id='" + expando + "'></a>" +
				"<select id='" + expando + "-\r\\' msallowcapture=''>" +
				"<option selected=''></option></select>";

			// Support: IE8, Opera 11-12.16
			// Nothing should be selected when empty strings follow ^= or $= or *=
			// The test attribute must be unknown in Opera but "safe" for WinRT
			// http://msdn.microsoft.com/en-us/library/ie/hh465388.aspx#attribute_section
			if ( div.querySelectorAll("[msallowcapture^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:''|\"\")" );
			}

			// Support: IE8
			// Boolean attributes and "value" are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:value|" + booleans + ")" );
			}

			// Support: Chrome<29, Android<4.4, Safari<7.0+, iOS<7.0+, PhantomJS<1.9.8+
			if ( !div.querySelectorAll( "[id~=" + expando + "-]" ).length ) {
				rbuggyQSA.push("~=");
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}

			// Support: Safari 8+, iOS 8+
			// https://bugs.webkit.org/show_bug.cgi?id=136851
			// In-page `selector#id sibing-combinator selector` fails
			if ( !div.querySelectorAll( "a#" + expando + "+*" ).length ) {
				rbuggyQSA.push(".#.+[+~]");
			}
		});

		assert(function( div ) {
			// Support: Windows 8 Native Apps
			// The type and name attributes are restricted during .innerHTML assignment
			var input = document.createElement("input");
			input.setAttribute( "type", "hidden" );
			div.appendChild( input ).setAttribute( "name", "D" );

			// Support: IE8
			// Enforce case-sensitivity of name attribute
			if ( div.querySelectorAll("[name=d]").length ) {
				rbuggyQSA.push( "name" + whitespace + "*[*^$|!~]?=" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Opera 10-11 does not throw on post-comma invalid pseudos
			div.querySelectorAll("*,:x");
			rbuggyQSA.push(",.*:");
		});
	}

	if ( (support.matchesSelector = rnative.test( (matches = docElem.matches ||
		docElem.webkitMatchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector) )) ) {

		assert(function( div ) {
			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( div, "div" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( div, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		});
	}

	rbuggyQSA = rbuggyQSA.length && new RegExp( rbuggyQSA.join("|") );
	rbuggyMatches = rbuggyMatches.length && new RegExp( rbuggyMatches.join("|") );

	/* Contains
	---------------------------------------------------------------------- */
	hasCompare = rnative.test( docElem.compareDocumentPosition );

	// Element contains another
	// Purposefully self-exclusive
	// As in, an element does not contain itself
	contains = hasCompare || rnative.test( docElem.contains ) ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			));
		} :
		function( a, b ) {
			if ( b ) {
				while ( (b = b.parentNode) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	/* Sorting
	---------------------------------------------------------------------- */

	// Document order sorting
	sortOrder = hasCompare ?
	function( a, b ) {

		// Flag for duplicate removal
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		// Sort on method existence if only one input has compareDocumentPosition
		var compare = !a.compareDocumentPosition - !b.compareDocumentPosition;
		if ( compare ) {
			return compare;
		}

		// Calculate position if both inputs belong to the same document
		compare = ( a.ownerDocument || a ) === ( b.ownerDocument || b ) ?
			a.compareDocumentPosition( b ) :

			// Otherwise we know they are disconnected
			1;

		// Disconnected nodes
		if ( compare & 1 ||
			(!support.sortDetached && b.compareDocumentPosition( a ) === compare) ) {

			// Choose the first element that is related to our preferred document
			if ( a === document || a.ownerDocument === preferredDoc && contains(preferredDoc, a) ) {
				return -1;
			}
			if ( b === document || b.ownerDocument === preferredDoc && contains(preferredDoc, b) ) {
				return 1;
			}

			// Maintain original order
			return sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;
		}

		return compare & 4 ? -1 : 1;
	} :
	function( a, b ) {
		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Parentless nodes are either documents or disconnected
		if ( !aup || !bup ) {
			return a === document ? -1 :
				b === document ? 1 :
				aup ? -1 :
				bup ? 1 :
				sortInput ?
				( indexOf( sortInput, a ) - indexOf( sortInput, b ) ) :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( (cur = cur.parentNode) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( (cur = cur.parentNode) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[i] === bp[i] ) {
			i++;
		}

		return i ?
			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[i], bp[i] ) :

			// Otherwise nodes in our document sort first
			ap[i] === preferredDoc ? -1 :
			bp[i] === preferredDoc ? 1 :
			0;
	};

	return document;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	// Make sure that attribute selectors are quoted
	expr = expr.replace( rattributeQuotes, "='$1']" );

	if ( support.matchesSelector && documentIsHTML &&
		!compilerCache[ expr + " " ] &&
		( !rbuggyMatches || !rbuggyMatches.test( expr ) ) &&
		( !rbuggyQSA     || !rbuggyQSA.test( expr ) ) ) {

		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||
					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch (e) {}
	}

	return Sizzle( expr, document, null, [ elem ] ).length > 0;
};

Sizzle.contains = function( context, elem ) {
	// Set document vars if needed
	if ( ( context.ownerDocument || context ) !== document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	var fn = Expr.attrHandle[ name.toLowerCase() ],
		// Don't get fooled by Object.prototype properties (jQuery #13807)
		val = fn && hasOwn.call( Expr.attrHandle, name.toLowerCase() ) ?
			fn( elem, name, !documentIsHTML ) :
			undefined;

	return val !== undefined ?
		val :
		support.attributes || !documentIsHTML ?
			elem.getAttribute( name ) :
			(val = elem.getAttributeNode(name)) && val.specified ?
				val.value :
				null;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

/**
 * Document sorting and removing duplicates
 * @param {ArrayLike} results
 */
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		j = 0,
		i = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	sortInput = !support.sortStable && results.slice( 0 );
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		while ( (elem = results[i++]) ) {
			if ( elem === results[ i ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	// Clear input after sorting to release objects
	// See https://github.com/jquery/sizzle/pull/225
	sortInput = null;

	return results;
};

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {
		// If no nodeType, this is expected to be an array
		while ( (node = elem[i++]) ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
		// Use textContent for elements
		// innerText usage removed for consistency of new lines (jQuery #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {
			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}
	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	attrHandle: {},

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[3] || match[4] || match[5] || "" ).replace( runescape, funescape );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1].slice( 0, 3 ) === "nth" ) {
				// nth-* requires argument
				if ( !match[3] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
				match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

			// other types prohibit arguments
			} else if ( match[3] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[6] && match[2];

			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[3] ) {
				match[2] = match[4] || match[5] || "";

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&
				// Get excess from tokenize (recursively)
				(excess = tokenize( unquoted, true )) &&
				// advance to the next closing parenthesis
				(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

				// excess is a negative index
				match[0] = match[0].slice( 0, excess );
				match[2] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeNameSelector ) {
			var nodeName = nodeNameSelector.replace( runescape, funescape ).toLowerCase();
			return nodeNameSelector === "*" ?
				function() { return true; } :
				function( elem ) {
					return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
				};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( typeof elem.className === "string" && elem.className || typeof elem.getAttribute !== "undefined" && elem.getAttribute("class") || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result.replace( rwhitespace, " " ) + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, what, argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, context, xml ) {
					var cache, uniqueCache, outerCache, node, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType,
						diff = false;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( (node = node[ dir ]) ) {
									if ( ofType ?
										node.nodeName.toLowerCase() === name :
										node.nodeType === 1 ) {

										return false;
									}
								}
								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {

							// Seek `elem` from a previously-cached index

							// ...in a gzip-friendly way
							node = parent;
							outerCache = node[ expando ] || (node[ expando ] = {});

							// Support: IE <9 only
							// Defend against cloned attroperties (jQuery gh-1709)
							uniqueCache = outerCache[ node.uniqueID ] ||
								(outerCache[ node.uniqueID ] = {});

							cache = uniqueCache[ type ] || [];
							nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
							diff = nodeIndex && cache[ 2 ];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( (node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								(diff = nodeIndex = 0) || start.pop()) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									uniqueCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						} else {
							// Use previously-cached element index if available
							if ( useCache ) {
								// ...in a gzip-friendly way
								node = elem;
								outerCache = node[ expando ] || (node[ expando ] = {});

								// Support: IE <9 only
								// Defend against cloned attroperties (jQuery gh-1709)
								uniqueCache = outerCache[ node.uniqueID ] ||
									(outerCache[ node.uniqueID ] = {});

								cache = uniqueCache[ type ] || [];
								nodeIndex = cache[ 0 ] === dirruns && cache[ 1 ];
								diff = nodeIndex;
							}

							// xml :nth-child(...)
							// or :nth-last-child(...) or :nth(-last)?-of-type(...)
							if ( diff === false ) {
								// Use the same loop as above to seek `elem` from the start
								while ( (node = ++nodeIndex && node && node[ dir ] ||
									(diff = nodeIndex = 0) || start.pop()) ) {

									if ( ( ofType ?
										node.nodeName.toLowerCase() === name :
										node.nodeType === 1 ) &&
										++diff ) {

										// Cache the index of each encountered element
										if ( useCache ) {
											outerCache = node[ expando ] || (node[ expando ] = {});

											// Support: IE <9 only
											// Defend against cloned attroperties (jQuery gh-1709)
											uniqueCache = outerCache[ node.uniqueID ] ||
												(outerCache[ node.uniqueID ] = {});

											uniqueCache[ type ] = [ dirruns, diff ];
										}

										if ( node === elem ) {
											break;
										}
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		// Potentially complex pseudos
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					// Don't keep the element (issue #299)
					input[0] = null;
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			text = text.replace( runescape, funescape );
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {
			// lang value must be a valid identifier
			if ( !ridentifier.test(lang || "") ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( (elemLang = documentIsHTML ?
						elem.lang :
						elem.getAttribute("xml:lang") || elem.getAttribute("lang")) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( (elem = elem.parentNode) && elem.nodeType === 1 );
				return false;
			};
		}),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		// Boolean properties
		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is negated by element (1) or content nodes (text: 3; cdata: 4; entity ref: 5),
			//   but not by others (comment: 8; processing instruction: 7; etc.)
			// nodeType < 6 works because attributes (2) do not appear as children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeType < 6 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&

				// Support: IE<8
				// New HTML5 attribute values (e.g., "search") appear with elem.type === "text"
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === "text" );
		},

		// Position-in-collection
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

// Easy API for creating new setFilters
function setFilters() {}
setFilters.prototype = Expr.filters = Expr.pseudos;
Expr.setFilters = new setFilters();

tokenize = Sizzle.tokenize = function( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( (tokens = []) );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			matched = match.shift();
			tokens.push({
				value: matched,
				// Cast descendant combinators to space
				type: match[0].replace( rtrim, " " )
			});
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {
				matched = match.shift();
				tokens.push({
					value: matched,
					type: type,
					matches: match
				});
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
};

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[i].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var oldCache, uniqueCache, outerCache,
				newCache = [ dirruns, doneName ];

			// We can't set arbitrary data on XML nodes, so they don't benefit from combinator caching
			if ( xml ) {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || (elem[ expando ] = {});

						// Support: IE <9 only
						// Defend against cloned attroperties (jQuery gh-1709)
						uniqueCache = outerCache[ elem.uniqueID ] || (outerCache[ elem.uniqueID ] = {});

						if ( (oldCache = uniqueCache[ dir ]) &&
							oldCache[ 0 ] === dirruns && oldCache[ 1 ] === doneName ) {

							// Assign to newCache so results back-propagate to previous elements
							return (newCache[ 2 ] = oldCache[ 2 ]);
						} else {
							// Reuse newcache so results back-propagate to previous elements
							uniqueCache[ dir ] = newCache;

							// A match means we're done; a fail means we have to keep checking
							if ( (newCache[ 2 ] = matcher( elem, context, xml )) ) {
								return true;
							}
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			var ret = ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
			// Avoid hanging onto element (issue #299)
			checkContext = null;
			return ret;
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector(
						// If the preceding token was a descendant combinator, insert an implicit any-element `*`
						tokens.slice( 0, i - 1 ).concat({ value: tokens[ i - 2 ].type === " " ? "*" : "" })
					).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	var bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, outermost ) {
			var elem, j, matcher,
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				setMatched = [],
				contextBackup = outermostContext,
				// We must always have either seed elements or outermost context
				elems = seed || byElement && Expr.find["TAG"]( "*", outermost ),
				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1),
				len = elems.length;

			if ( outermost ) {
				outermostContext = context === document || context || outermost;
			}

			// Add elements passing elementMatchers directly to results
			// Support: IE<9, Safari
			// Tolerate NodeList properties (IE: "length"; Safari: <number>) matching elements by id
			for ( ; i !== len && (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;
					if ( !context && elem.ownerDocument !== document ) {
						setDocument( elem );
						xml = !documentIsHTML;
					}
					while ( (matcher = elementMatchers[j++]) ) {
						if ( matcher( elem, context || document, xml) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// `i` is now the count of elements visited above, and adding it to `matchedCount`
			// makes the latter nonnegative.
			matchedCount += i;

			// Apply set filters to unmatched elements
			// NOTE: This can be skipped if there are no unmatched elements (i.e., `matchedCount`
			// equals `i`), unless we didn't visit _any_ elements in the above loop because we have
			// no element matchers and no seed.
			// Incrementing an initially-string "0" `i` allows `i` to remain a string only in that
			// case, which will result in a "00" `matchedCount` that differs from `i` but is also
			// numerically zero.
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( (matcher = setMatchers[j++]) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, match /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !match ) {
			match = tokenize( selector );
		}
		i = match.length;
		while ( i-- ) {
			cached = matcherFromTokens( match[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );

		// Save selector and tokenization
		cached.selector = selector;
	}
	return cached;
};

/**
 * A low-level selection function that works with Sizzle's compiled
 *  selector functions
 * @param {String|Function} selector A selector or a pre-compiled
 *  selector function built with Sizzle.compile
 * @param {Element} context
 * @param {Array} [results]
 * @param {Array} [seed] A set of elements to match against
 */
select = Sizzle.select = function( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		compiled = typeof selector === "function" && selector,
		match = !seed && tokenize( (selector = compiled.selector || selector) );

	results = results || [];

	// Try to minimize operations if there is only one selector in the list and no seed
	// (the latter of which guarantees us context)
	if ( match.length === 1 ) {

		// Reduce context if the leading compound selector is an ID
		tokens = match[0] = match[0].slice( 0 );
		if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
				support.getById && context.nodeType === 9 && documentIsHTML &&
				Expr.relative[ tokens[1].type ] ) {

			context = ( Expr.find["ID"]( token.matches[0].replace(runescape, funescape), context ) || [] )[0];
			if ( !context ) {
				return results;

			// Precompiled matchers will still verify ancestry, so step up a level
			} else if ( compiled ) {
				context = context.parentNode;
			}

			selector = selector.slice( tokens.shift().value.length );
		}

		// Fetch a seed set for right-to-left matching
		i = matchExpr["needsContext"].test( selector ) ? 0 : tokens.length;
		while ( i-- ) {
			token = tokens[i];

			// Abort if we hit a combinator
			if ( Expr.relative[ (type = token.type) ] ) {
				break;
			}
			if ( (find = Expr.find[ type ]) ) {
				// Search, expanding context for leading sibling combinators
				if ( (seed = find(
					token.matches[0].replace( runescape, funescape ),
					rsibling.test( tokens[0].type ) && testContext( context.parentNode ) || context
				)) ) {

					// If seed is empty or no tokens remain, we can return early
					tokens.splice( i, 1 );
					selector = seed.length && toSelector( tokens );
					if ( !selector ) {
						push.apply( results, seed );
						return results;
					}

					break;
				}
			}
		}
	}

	// Compile and execute a filtering function if one is not provided
	// Provide `match` to avoid retokenization if we modified the selector above
	( compiled || compile( selector, match ) )(
		seed,
		context,
		!documentIsHTML,
		results,
		!context || rsibling.test( selector ) && testContext( context.parentNode ) || context
	);
	return results;
};

// One-time assignments

// Sort stability
support.sortStable = expando.split("").sort( sortOrder ).join("") === expando;

// Support: Chrome 14-35+
// Always assume duplicates if they aren't passed to the comparison function
support.detectDuplicates = !!hasDuplicate;

// Initialize against the default document
setDocument();

// Support: Webkit<537.32 - Safari 6.0.3/Chrome 25 (fixed in Chrome 27)
// Detached nodes confoundingly follow *each other*
support.sortDetached = assert(function( div1 ) {
	// Should return 1, but returns 4 (following)
	return div1.compareDocumentPosition( document.createElement("div") ) & 1;
});

// Support: IE<8
// Prevent attribute/property "interpolation"
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !assert(function( div ) {
	div.innerHTML = "<a href='#'></a>";
	return div.firstChild.getAttribute("href") === "#" ;
}) ) {
	addHandle( "type|href|height|width", function( elem, name, isXML ) {
		if ( !isXML ) {
			return elem.getAttribute( name, name.toLowerCase() === "type" ? 1 : 2 );
		}
	});
}

// Support: IE<9
// Use defaultValue in place of getAttribute("value")
if ( !support.attributes || !assert(function( div ) {
	div.innerHTML = "<input/>";
	div.firstChild.setAttribute( "value", "" );
	return div.firstChild.getAttribute( "value" ) === "";
}) ) {
	addHandle( "value", function( elem, name, isXML ) {
		if ( !isXML && elem.nodeName.toLowerCase() === "input" ) {
			return elem.defaultValue;
		}
	});
}

// Support: IE<9
// Use getAttributeNode to fetch booleans when getAttribute lies
if ( !assert(function( div ) {
	return div.getAttribute("disabled") == null;
}) ) {
	addHandle( booleans, function( elem, name, isXML ) {
		var val;
		if ( !isXML ) {
			return elem[ name ] === true ? name.toLowerCase() :
					(val = elem.getAttributeNode( name )) && val.specified ?
					val.value :
				null;
		}
	});
}

return Sizzle;

})( window );



jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[ ":" ] = jQuery.expr.pseudos;
jQuery.uniqueSort = jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;



var dir = function( elem, dir, until ) {
	var matched = [],
		truncate = until !== undefined;

	while ( ( elem = elem[ dir ] ) && elem.nodeType !== 9 ) {
		if ( elem.nodeType === 1 ) {
			if ( truncate && jQuery( elem ).is( until ) ) {
				break;
			}
			matched.push( elem );
		}
	}
	return matched;
};


var siblings = function( n, elem ) {
	var matched = [];

	for ( ; n; n = n.nextSibling ) {
		if ( n.nodeType === 1 && n !== elem ) {
			matched.push( n );
		}
	}

	return matched;
};


var rneedsContext = jQuery.expr.match.needsContext;

var rsingleTag = ( /^<([\w-]+)\s*\/?>(?:<\/\1>|)$/ );



var risSimple = /^.[^:#\[\.,]*$/;

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, not ) {
	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep( elements, function( elem, i ) {
			/* jshint -W018 */
			return !!qualifier.call( elem, i, elem ) !== not;
		} );

	}

	if ( qualifier.nodeType ) {
		return jQuery.grep( elements, function( elem ) {
			return ( elem === qualifier ) !== not;
		} );

	}

	if ( typeof qualifier === "string" ) {
		if ( risSimple.test( qualifier ) ) {
			return jQuery.filter( qualifier, elements, not );
		}

		qualifier = jQuery.filter( qualifier, elements );
	}

	return jQuery.grep( elements, function( elem ) {
		return ( indexOf.call( qualifier, elem ) > -1 ) !== not;
	} );
}

jQuery.filter = function( expr, elems, not ) {
	var elem = elems[ 0 ];

	if ( not ) {
		expr = ":not(" + expr + ")";
	}

	return elems.length === 1 && elem.nodeType === 1 ?
		jQuery.find.matchesSelector( elem, expr ) ? [ elem ] : [] :
		jQuery.find.matches( expr, jQuery.grep( elems, function( elem ) {
			return elem.nodeType === 1;
		} ) );
};

jQuery.fn.extend( {
	find: function( selector ) {
		var i,
			len = this.length,
			ret = [],
			self = this;

		if ( typeof selector !== "string" ) {
			return this.pushStack( jQuery( selector ).filter( function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			} ) );
		}

		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, self[ i ], ret );
		}

		// Needed because $( selector, context ) becomes $( context ).find( selector )
		ret = this.pushStack( len > 1 ? jQuery.unique( ret ) : ret );
		ret.selector = this.selector ? this.selector + " " + selector : selector;
		return ret;
	},
	filter: function( selector ) {
		return this.pushStack( winnow( this, selector || [], false ) );
	},
	not: function( selector ) {
		return this.pushStack( winnow( this, selector || [], true ) );
	},
	is: function( selector ) {
		return !!winnow(
			this,

			// If this is a positional/relative selector, check membership in the returned set
			// so $("p:first").is("p:last") won't return true for a doc with two "p".
			typeof selector === "string" && rneedsContext.test( selector ) ?
				jQuery( selector ) :
				selector || [],
			false
		).length;
	}
} );


// Initialize a jQuery object


// A central reference to the root jQuery(document)
var rootjQuery,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	rquickExpr = /^(?:\s*(<[\w\W]+>)[^>]*|#([\w-]*))$/,

	init = jQuery.fn.init = function( selector, context, root ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Method init() accepts an alternate rootjQuery
		// so migrate can support jQuery.sub (gh-2101)
		root = root || rootjQuery;

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector[ 0 ] === "<" &&
				selector[ selector.length - 1 ] === ">" &&
				selector.length >= 3 ) {

				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && ( match[ 1 ] || !context ) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[ 1 ] ) {
					context = context instanceof jQuery ? context[ 0 ] : context;

					// Option to run scripts is true for back-compat
					// Intentionally let the error be thrown if parseHTML is not present
					jQuery.merge( this, jQuery.parseHTML(
						match[ 1 ],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[ 1 ] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {

							// Properties of context are called as methods if possible
							if ( jQuery.isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[ 2 ] );

					// Support: Blackberry 4.6
					// gEBID returns nodes no longer in the document (#6963)
					if ( elem && elem.parentNode ) {

						// Inject the element directly into the jQuery object
						this.length = 1;
						this[ 0 ] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || root ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this.context = this[ 0 ] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return root.ready !== undefined ?
				root.ready( selector ) :

				// Execute immediately if ready is not present
				selector( jQuery );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	};

// Give the init function the jQuery prototype for later instantiation
init.prototype = jQuery.fn;

// Initialize central reference
rootjQuery = jQuery( document );


var rparentsprev = /^(?:parents|prev(?:Until|All))/,

	// Methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend( {
	has: function( target ) {
		var targets = jQuery( target, this ),
			l = targets.length;

		return this.filter( function() {
			var i = 0;
			for ( ; i < l; i++ ) {
				if ( jQuery.contains( this, targets[ i ] ) ) {
					return true;
				}
			}
		} );
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			matched = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			for ( cur = this[ i ]; cur && cur !== context; cur = cur.parentNode ) {

				// Always skip document fragments
				if ( cur.nodeType < 11 && ( pos ?
					pos.index( cur ) > -1 :

					// Don't pass non-elements to Sizzle
					cur.nodeType === 1 &&
						jQuery.find.matchesSelector( cur, selectors ) ) ) {

					matched.push( cur );
					break;
				}
			}
		}

		return this.pushStack( matched.length > 1 ? jQuery.uniqueSort( matched ) : matched );
	},

	// Determine the position of an element within the set
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[ 0 ] && this[ 0 ].parentNode ) ? this.first().prevAll().length : -1;
		}

		// Index in selector
		if ( typeof elem === "string" ) {
			return indexOf.call( jQuery( elem ), this[ 0 ] );
		}

		// Locate the position of the desired element
		return indexOf.call( this,

			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[ 0 ] : elem
		);
	},

	add: function( selector, context ) {
		return this.pushStack(
			jQuery.uniqueSort(
				jQuery.merge( this.get(), jQuery( selector, context ) )
			)
		);
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter( selector )
		);
	}
} );

function sibling( cur, dir ) {
	while ( ( cur = cur[ dir ] ) && cur.nodeType !== 1 ) {}
	return cur;
}

jQuery.each( {
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return siblings( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return siblings( elem.firstChild );
	},
	contents: function( elem ) {
		return elem.contentDocument || jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var matched = jQuery.map( this, fn, until );

		if ( name.slice( -5 ) !== "Until" ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			matched = jQuery.filter( selector, matched );
		}

		if ( this.length > 1 ) {

			// Remove duplicates
			if ( !guaranteedUnique[ name ] ) {
				jQuery.uniqueSort( matched );
			}

			// Reverse order for parents* and prev-derivatives
			if ( rparentsprev.test( name ) ) {
				matched.reverse();
			}
		}

		return this.pushStack( matched );
	};
} );
var rnotwhite = ( /\S+/g );



// Convert String-formatted options into Object-formatted ones
function createOptions( options ) {
	var object = {};
	jQuery.each( options.match( rnotwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	} );
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		createOptions( options ) :
		jQuery.extend( {}, options );

	var // Flag to know if list is currently firing
		firing,

		// Last fire value for non-forgettable lists
		memory,

		// Flag to know if list was already fired
		fired,

		// Flag to prevent firing
		locked,

		// Actual callback list
		list = [],

		// Queue of execution data for repeatable lists
		queue = [],

		// Index of currently firing callback (modified by add/remove as needed)
		firingIndex = -1,

		// Fire callbacks
		fire = function() {

			// Enforce single-firing
			locked = options.once;

			// Execute callbacks for all pending executions,
			// respecting firingIndex overrides and runtime changes
			fired = firing = true;
			for ( ; queue.length; firingIndex = -1 ) {
				memory = queue.shift();
				while ( ++firingIndex < list.length ) {

					// Run callback and check for early termination
					if ( list[ firingIndex ].apply( memory[ 0 ], memory[ 1 ] ) === false &&
						options.stopOnFalse ) {

						// Jump to end and forget the data so .add doesn't re-fire
						firingIndex = list.length;
						memory = false;
					}
				}
			}

			// Forget the data if we're done with it
			if ( !options.memory ) {
				memory = false;
			}

			firing = false;

			// Clean up if we're done firing for good
			if ( locked ) {

				// Keep an empty list if we have data for future add calls
				if ( memory ) {
					list = [];

				// Otherwise, this object is spent
				} else {
					list = "";
				}
			}
		},

		// Actual Callbacks object
		self = {

			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {

					// If we have memory from a past run, we should fire after adding
					if ( memory && !firing ) {
						firingIndex = list.length - 1;
						queue.push( memory );
					}

					( function add( args ) {
						jQuery.each( args, function( _, arg ) {
							if ( jQuery.isFunction( arg ) ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && jQuery.type( arg ) !== "string" ) {

								// Inspect recursively
								add( arg );
							}
						} );
					} )( arguments );

					if ( memory && !firing ) {
						fire();
					}
				}
				return this;
			},

			// Remove a callback from the list
			remove: function() {
				jQuery.each( arguments, function( _, arg ) {
					var index;
					while ( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
						list.splice( index, 1 );

						// Handle firing indexes
						if ( index <= firingIndex ) {
							firingIndex--;
						}
					}
				} );
				return this;
			},

			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ?
					jQuery.inArray( fn, list ) > -1 :
					list.length > 0;
			},

			// Remove all callbacks from the list
			empty: function() {
				if ( list ) {
					list = [];
				}
				return this;
			},

			// Disable .fire and .add
			// Abort any current/pending executions
			// Clear all callbacks and values
			disable: function() {
				locked = queue = [];
				list = memory = "";
				return this;
			},
			disabled: function() {
				return !list;
			},

			// Disable .fire
			// Also disable .add unless we have memory (since it would have no effect)
			// Abort any pending executions
			lock: function() {
				locked = queue = [];
				if ( !memory ) {
					list = memory = "";
				}
				return this;
			},
			locked: function() {
				return !!locked;
			},

			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				if ( !locked ) {
					args = args || [];
					args = [ context, args.slice ? args.slice() : args ];
					queue.push( args );
					if ( !firing ) {
						fire();
					}
				}
				return this;
			},

			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},

			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};


jQuery.extend( {

	Deferred: function( func ) {
		var tuples = [

				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks( "once memory" ), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks( "once memory" ), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks( "memory" ) ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred( function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];

							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[ 1 ] ]( function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && jQuery.isFunction( returned.promise ) ) {
									returned.promise()
										.progress( newDefer.notify )
										.done( newDefer.resolve )
										.fail( newDefer.reject );
								} else {
									newDefer[ tuple[ 0 ] + "With" ](
										this === promise ? newDefer.promise() : this,
										fn ? [ returned ] : arguments
									);
								}
							} );
						} );
						fns = null;
					} ).promise();
				},

				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[ 1 ] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add( function() {

					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ]
			deferred[ tuple[ 0 ] ] = function() {
				deferred[ tuple[ 0 ] + "With" ]( this === deferred ? promise : this, arguments );
				return this;
			};
			deferred[ tuple[ 0 ] + "With" ] = list.fireWith;
		} );

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 ||
				( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred.
			// If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? slice.call( arguments ) : value;
					if ( values === progressValues ) {
						deferred.notifyWith( contexts, values );
					} else if ( !( --remaining ) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// Add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.progress( updateFunc( i, progressContexts, progressValues ) )
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject );
				} else {
					--remaining;
				}
			}
		}

		// If we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
} );


// The deferred used on DOM ready
var readyList;

jQuery.fn.ready = function( fn ) {

	// Add the callback
	jQuery.ready.promise().done( fn );

	return this;
};

jQuery.extend( {

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.triggerHandler ) {
			jQuery( document ).triggerHandler( "ready" );
			jQuery( document ).off( "ready" );
		}
	}
} );

/**
 * The ready event handler and self cleanup method
 */
function completed() {
	document.removeEventListener( "DOMContentLoaded", completed );
	window.removeEventListener( "load", completed );
	jQuery.ready();
}

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called
		// after the browser event has already occurred.
		// Support: IE9-10 only
		// Older IE sometimes signals "interactive" too soon
		if ( document.readyState === "complete" ||
			( document.readyState !== "loading" && !document.documentElement.doScroll ) ) {

			// Handle it asynchronously to allow scripts the opportunity to delay ready
			window.setTimeout( jQuery.ready );

		} else {

			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", completed );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", completed );
		}
	}
	return readyList.promise( obj );
};

// Kick off the DOM ready check even if the user does not
jQuery.ready.promise();




// Multifunctional method to get and set values of a collection
// The value/s can optionally be executed if it's a function
var access = function( elems, fn, key, value, chainable, emptyGet, raw ) {
	var i = 0,
		len = elems.length,
		bulk = key == null;

	// Sets many values
	if ( jQuery.type( key ) === "object" ) {
		chainable = true;
		for ( i in key ) {
			access( elems, fn, i, key[ i ], true, emptyGet, raw );
		}

	// Sets one value
	} else if ( value !== undefined ) {
		chainable = true;

		if ( !jQuery.isFunction( value ) ) {
			raw = true;
		}

		if ( bulk ) {

			// Bulk operations run against the entire set
			if ( raw ) {
				fn.call( elems, value );
				fn = null;

			// ...except when executing function values
			} else {
				bulk = fn;
				fn = function( elem, key, value ) {
					return bulk.call( jQuery( elem ), value );
				};
			}
		}

		if ( fn ) {
			for ( ; i < len; i++ ) {
				fn(
					elems[ i ], key, raw ?
					value :
					value.call( elems[ i ], i, fn( elems[ i ], key ) )
				);
			}
		}
	}

	return chainable ?
		elems :

		// Gets
		bulk ?
			fn.call( elems ) :
			len ? fn( elems[ 0 ], key ) : emptyGet;
};
var acceptData = function( owner ) {

	// Accepts only:
	//  - Node
	//    - Node.ELEMENT_NODE
	//    - Node.DOCUMENT_NODE
	//  - Object
	//    - Any
	/* jshint -W018 */
	return owner.nodeType === 1 || owner.nodeType === 9 || !( +owner.nodeType );
};




function Data() {
	this.expando = jQuery.expando + Data.uid++;
}

Data.uid = 1;

Data.prototype = {

	register: function( owner, initial ) {
		var value = initial || {};

		// If it is a node unlikely to be stringify-ed or looped over
		// use plain assignment
		if ( owner.nodeType ) {
			owner[ this.expando ] = value;

		// Otherwise secure it in a non-enumerable, non-writable property
		// configurability must be true to allow the property to be
		// deleted with the delete operator
		} else {
			Object.defineProperty( owner, this.expando, {
				value: value,
				writable: true,
				configurable: true
			} );
		}
		return owner[ this.expando ];
	},
	cache: function( owner ) {

		// We can accept data for non-element nodes in modern browsers,
		// but we should not, see #8335.
		// Always return an empty object.
		if ( !acceptData( owner ) ) {
			return {};
		}

		// Check if the owner object already has a cache
		var value = owner[ this.expando ];

		// If not, create one
		if ( !value ) {
			value = {};

			// We can accept data for non-element nodes in modern browsers,
			// but we should not, see #8335.
			// Always return an empty object.
			if ( acceptData( owner ) ) {

				// If it is a node unlikely to be stringify-ed or looped over
				// use plain assignment
				if ( owner.nodeType ) {
					owner[ this.expando ] = value;

				// Otherwise secure it in a non-enumerable property
				// configurable must be true to allow the property to be
				// deleted when data is removed
				} else {
					Object.defineProperty( owner, this.expando, {
						value: value,
						configurable: true
					} );
				}
			}
		}

		return value;
	},
	set: function( owner, data, value ) {
		var prop,
			cache = this.cache( owner );

		// Handle: [ owner, key, value ] args
		if ( typeof data === "string" ) {
			cache[ data ] = value;

		// Handle: [ owner, { properties } ] args
		} else {

			// Copy the properties one-by-one to the cache object
			for ( prop in data ) {
				cache[ prop ] = data[ prop ];
			}
		}
		return cache;
	},
	get: function( owner, key ) {
		return key === undefined ?
			this.cache( owner ) :
			owner[ this.expando ] && owner[ this.expando ][ key ];
	},
	access: function( owner, key, value ) {
		var stored;

		// In cases where either:
		//
		//   1. No key was specified
		//   2. A string key was specified, but no value provided
		//
		// Take the "read" path and allow the get method to determine
		// which value to return, respectively either:
		//
		//   1. The entire cache object
		//   2. The data stored at the key
		//
		if ( key === undefined ||
				( ( key && typeof key === "string" ) && value === undefined ) ) {

			stored = this.get( owner, key );

			return stored !== undefined ?
				stored : this.get( owner, jQuery.camelCase( key ) );
		}

		// When the key is not a string, or both a key and value
		// are specified, set or extend (existing objects) with either:
		//
		//   1. An object of properties
		//   2. A key and value
		//
		this.set( owner, key, value );

		// Since the "set" path can have two possible entry points
		// return the expected data based on which path was taken[*]
		return value !== undefined ? value : key;
	},
	remove: function( owner, key ) {
		var i, name, camel,
			cache = owner[ this.expando ];

		if ( cache === undefined ) {
			return;
		}

		if ( key === undefined ) {
			this.register( owner );

		} else {

			// Support array or space separated string of keys
			if ( jQuery.isArray( key ) ) {

				// If "name" is an array of keys...
				// When data is initially created, via ("key", "val") signature,
				// keys will be converted to camelCase.
				// Since there is no way to tell _how_ a key was added, remove
				// both plain key and camelCase key. #12786
				// This will only penalize the array argument path.
				name = key.concat( key.map( jQuery.camelCase ) );
			} else {
				camel = jQuery.camelCase( key );

				// Try the string as a key before any manipulation
				if ( key in cache ) {
					name = [ key, camel ];
				} else {

					// If a key with the spaces exists, use it.
					// Otherwise, create an array by matching non-whitespace
					name = camel;
					name = name in cache ?
						[ name ] : ( name.match( rnotwhite ) || [] );
				}
			}

			i = name.length;

			while ( i-- ) {
				delete cache[ name[ i ] ];
			}
		}

		// Remove the expando if there's no more data
		if ( key === undefined || jQuery.isEmptyObject( cache ) ) {

			// Support: Chrome <= 35-45+
			// Webkit & Blink performance suffers when deleting properties
			// from DOM nodes, so set to undefined instead
			// https://code.google.com/p/chromium/issues/detail?id=378607
			if ( owner.nodeType ) {
				owner[ this.expando ] = undefined;
			} else {
				delete owner[ this.expando ];
			}
		}
	},
	hasData: function( owner ) {
		var cache = owner[ this.expando ];
		return cache !== undefined && !jQuery.isEmptyObject( cache );
	}
};
var dataPriv = new Data();

var dataUser = new Data();



//	Implementation Summary
//
//	1. Enforce API surface and semantic compatibility with 1.9.x branch
//	2. Improve the module's maintainability by reducing the storage
//		paths to a single mechanism.
//	3. Use the same single mechanism to support "private" and "user" data.
//	4. _Never_ expose "private" data to user code (TODO: Drop _data, _removeData)
//	5. Avoid exposing implementation details on user objects (eg. expando properties)
//	6. Provide a clear path for implementation upgrade to WeakMap in 2014

var rbrace = /^(?:\{[\w\W]*\}|\[[\w\W]*\])$/,
	rmultiDash = /[A-Z]/g;

function dataAttr( elem, key, data ) {
	var name;

	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {
		name = "data-" + key.replace( rmultiDash, "-$&" ).toLowerCase();
		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
					data === "false" ? false :
					data === "null" ? null :

					// Only convert to a number if it doesn't change the string
					+data + "" === data ? +data :
					rbrace.test( data ) ? jQuery.parseJSON( data ) :
					data;
			} catch ( e ) {}

			// Make sure we set the data so it isn't changed later
			dataUser.set( elem, key, data );
		} else {
			data = undefined;
		}
	}
	return data;
}

jQuery.extend( {
	hasData: function( elem ) {
		return dataUser.hasData( elem ) || dataPriv.hasData( elem );
	},

	data: function( elem, name, data ) {
		return dataUser.access( elem, name, data );
	},

	removeData: function( elem, name ) {
		dataUser.remove( elem, name );
	},

	// TODO: Now that all calls to _data and _removeData have been replaced
	// with direct calls to dataPriv methods, these can be deprecated.
	_data: function( elem, name, data ) {
		return dataPriv.access( elem, name, data );
	},

	_removeData: function( elem, name ) {
		dataPriv.remove( elem, name );
	}
} );

jQuery.fn.extend( {
	data: function( key, value ) {
		var i, name, data,
			elem = this[ 0 ],
			attrs = elem && elem.attributes;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = dataUser.get( elem );

				if ( elem.nodeType === 1 && !dataPriv.get( elem, "hasDataAttrs" ) ) {
					i = attrs.length;
					while ( i-- ) {

						// Support: IE11+
						// The attrs elements can be null (#14894)
						if ( attrs[ i ] ) {
							name = attrs[ i ].name;
							if ( name.indexOf( "data-" ) === 0 ) {
								name = jQuery.camelCase( name.slice( 5 ) );
								dataAttr( elem, name, data[ name ] );
							}
						}
					}
					dataPriv.set( elem, "hasDataAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each( function() {
				dataUser.set( this, key );
			} );
		}

		return access( this, function( value ) {
			var data, camelKey;

			// The calling jQuery object (element matches) is not empty
			// (and therefore has an element appears at this[ 0 ]) and the
			// `value` parameter was not undefined. An empty jQuery object
			// will result in `undefined` for elem = this[ 0 ] which will
			// throw an exception if an attempt to read a data cache is made.
			if ( elem && value === undefined ) {

				// Attempt to get data from the cache
				// with the key as-is
				data = dataUser.get( elem, key ) ||

					// Try to find dashed key if it exists (gh-2779)
					// This is for 2.2.x only
					dataUser.get( elem, key.replace( rmultiDash, "-$&" ).toLowerCase() );

				if ( data !== undefined ) {
					return data;
				}

				camelKey = jQuery.camelCase( key );

				// Attempt to get data from the cache
				// with the key camelized
				data = dataUser.get( elem, camelKey );
				if ( data !== undefined ) {
					return data;
				}

				// Attempt to "discover" the data in
				// HTML5 custom data-* attrs
				data = dataAttr( elem, camelKey, undefined );
				if ( data !== undefined ) {
					return data;
				}

				// We tried really hard, but the data doesn't exist.
				return;
			}

			// Set the data...
			camelKey = jQuery.camelCase( key );
			this.each( function() {

				// First, attempt to store a copy or reference of any
				// data that might've been store with a camelCased key.
				var data = dataUser.get( this, camelKey );

				// For HTML5 data-* attribute interop, we have to
				// store property names with dashes in a camelCase form.
				// This might not apply to all properties...*
				dataUser.set( this, camelKey, value );

				// *... In the case of properties that might _actually_
				// have dashes, we need to also store a copy of that
				// unchanged property.
				if ( key.indexOf( "-" ) > -1 && data !== undefined ) {
					dataUser.set( this, key, value );
				}
			} );
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each( function() {
			dataUser.remove( this, key );
		} );
	}
} );


jQuery.extend( {
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = dataPriv.get( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray( data ) ) {
					queue = dataPriv.access( elem, type, jQuery.makeArray( data ) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// Clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// Not public - generate a queueHooks object, or return the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return dataPriv.get( elem, key ) || dataPriv.access( elem, key, {
			empty: jQuery.Callbacks( "once memory" ).add( function() {
				dataPriv.remove( elem, [ type + "queue", key ] );
			} )
		} );
	}
} );

jQuery.fn.extend( {
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[ 0 ], type );
		}

		return data === undefined ?
			this :
			this.each( function() {
				var queue = jQuery.queue( this, type, data );

				// Ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[ 0 ] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			} );
	},
	dequeue: function( type ) {
		return this.each( function() {
			jQuery.dequeue( this, type );
		} );
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},

	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while ( i-- ) {
			tmp = dataPriv.get( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
} );
var pnum = ( /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/ ).source;

var rcssNum = new RegExp( "^(?:([+-])=|)(" + pnum + ")([a-z%]*)$", "i" );


var cssExpand = [ "Top", "Right", "Bottom", "Left" ];

var isHidden = function( elem, el ) {

		// isHidden might be called from jQuery#filter function;
		// in that case, element will be second argument
		elem = el || elem;
		return jQuery.css( elem, "display" ) === "none" ||
			!jQuery.contains( elem.ownerDocument, elem );
	};



function adjustCSS( elem, prop, valueParts, tween ) {
	var adjusted,
		scale = 1,
		maxIterations = 20,
		currentValue = tween ?
			function() { return tween.cur(); } :
			function() { return jQuery.css( elem, prop, "" ); },
		initial = currentValue(),
		unit = valueParts && valueParts[ 3 ] || ( jQuery.cssNumber[ prop ] ? "" : "px" ),

		// Starting value computation is required for potential unit mismatches
		initialInUnit = ( jQuery.cssNumber[ prop ] || unit !== "px" && +initial ) &&
			rcssNum.exec( jQuery.css( elem, prop ) );

	if ( initialInUnit && initialInUnit[ 3 ] !== unit ) {

		// Trust units reported by jQuery.css
		unit = unit || initialInUnit[ 3 ];

		// Make sure we update the tween properties later on
		valueParts = valueParts || [];

		// Iteratively approximate from a nonzero starting point
		initialInUnit = +initial || 1;

		do {

			// If previous iteration zeroed out, double until we get *something*.
			// Use string for doubling so we don't accidentally see scale as unchanged below
			scale = scale || ".5";

			// Adjust and apply
			initialInUnit = initialInUnit / scale;
			jQuery.style( elem, prop, initialInUnit + unit );

		// Update scale, tolerating zero or NaN from tween.cur()
		// Break the loop if scale is unchanged or perfect, or if we've just had enough.
		} while (
			scale !== ( scale = currentValue() / initial ) && scale !== 1 && --maxIterations
		);
	}

	if ( valueParts ) {
		initialInUnit = +initialInUnit || +initial || 0;

		// Apply relative offset (+=/-=) if specified
		adjusted = valueParts[ 1 ] ?
			initialInUnit + ( valueParts[ 1 ] + 1 ) * valueParts[ 2 ] :
			+valueParts[ 2 ];
		if ( tween ) {
			tween.unit = unit;
			tween.start = initialInUnit;
			tween.end = adjusted;
		}
	}
	return adjusted;
}
var rcheckableType = ( /^(?:checkbox|radio)$/i );

var rtagName = ( /<([\w:-]+)/ );

var rscriptType = ( /^$|\/(?:java|ecma)script/i );



// We have to close these tags to support XHTML (#13200)
var wrapMap = {

	// Support: IE9
	option: [ 1, "<select multiple='multiple'>", "</select>" ],

	// XHTML parsers do not magically insert elements in the
	// same way that tag soup parsers do. So we cannot shorten
	// this by omitting <tbody> or other required elements.
	thead: [ 1, "<table>", "</table>" ],
	col: [ 2, "<table><colgroup>", "</colgroup></table>" ],
	tr: [ 2, "<table><tbody>", "</tbody></table>" ],
	td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

	_default: [ 0, "", "" ]
};

// Support: IE9
wrapMap.optgroup = wrapMap.option;

wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;


function getAll( context, tag ) {

	// Support: IE9-11+
	// Use typeof to avoid zero-argument method invocation on host objects (#15151)
	var ret = typeof context.getElementsByTagName !== "undefined" ?
			context.getElementsByTagName( tag || "*" ) :
			typeof context.querySelectorAll !== "undefined" ?
				context.querySelectorAll( tag || "*" ) :
			[];

	return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
		jQuery.merge( [ context ], ret ) :
		ret;
}


// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		dataPriv.set(
			elems[ i ],
			"globalEval",
			!refElements || dataPriv.get( refElements[ i ], "globalEval" )
		);
	}
}


var rhtml = /<|&#?\w+;/;

function buildFragment( elems, context, scripts, selection, ignored ) {
	var elem, tmp, tag, wrap, contains, j,
		fragment = context.createDocumentFragment(),
		nodes = [],
		i = 0,
		l = elems.length;

	for ( ; i < l; i++ ) {
		elem = elems[ i ];

		if ( elem || elem === 0 ) {

			// Add nodes directly
			if ( jQuery.type( elem ) === "object" ) {

				// Support: Android<4.1, PhantomJS<2
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

			// Convert non-html into a text node
			} else if ( !rhtml.test( elem ) ) {
				nodes.push( context.createTextNode( elem ) );

			// Convert html into DOM nodes
			} else {
				tmp = tmp || fragment.appendChild( context.createElement( "div" ) );

				// Deserialize a standard representation
				tag = ( rtagName.exec( elem ) || [ "", "" ] )[ 1 ].toLowerCase();
				wrap = wrapMap[ tag ] || wrapMap._default;
				tmp.innerHTML = wrap[ 1 ] + jQuery.htmlPrefilter( elem ) + wrap[ 2 ];

				// Descend through wrappers to the right content
				j = wrap[ 0 ];
				while ( j-- ) {
					tmp = tmp.lastChild;
				}

				// Support: Android<4.1, PhantomJS<2
				// push.apply(_, arraylike) throws on ancient WebKit
				jQuery.merge( nodes, tmp.childNodes );

				// Remember the top-level container
				tmp = fragment.firstChild;

				// Ensure the created nodes are orphaned (#12392)
				tmp.textContent = "";
			}
		}
	}

	// Remove wrapper from fragment
	fragment.textContent = "";

	i = 0;
	while ( ( elem = nodes[ i++ ] ) ) {

		// Skip elements already in the context collection (trac-4087)
		if ( selection && jQuery.inArray( elem, selection ) > -1 ) {
			if ( ignored ) {
				ignored.push( elem );
			}
			continue;
		}

		contains = jQuery.contains( elem.ownerDocument, elem );

		// Append to fragment
		tmp = getAll( fragment.appendChild( elem ), "script" );

		// Preserve script evaluation history
		if ( contains ) {
			setGlobalEval( tmp );
		}

		// Capture executables
		if ( scripts ) {
			j = 0;
			while ( ( elem = tmp[ j++ ] ) ) {
				if ( rscriptType.test( elem.type || "" ) ) {
					scripts.push( elem );
				}
			}
		}
	}

	return fragment;
}


( function() {
	var fragment = document.createDocumentFragment(),
		div = fragment.appendChild( document.createElement( "div" ) ),
		input = document.createElement( "input" );

	// Support: Android 4.0-4.3, Safari<=5.1
	// Check state lost if the name is set (#11217)
	// Support: Windows Web Apps (WWA)
	// `name` and `type` must use .setAttribute for WWA (#14901)
	input.setAttribute( "type", "radio" );
	input.setAttribute( "checked", "checked" );
	input.setAttribute( "name", "t" );

	div.appendChild( input );

	// Support: Safari<=5.1, Android<4.2
	// Older WebKit doesn't clone checked state correctly in fragments
	support.checkClone = div.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE<=11+
	// Make sure textarea (and checkbox) defaultValue is properly cloned
	div.innerHTML = "<textarea>x</textarea>";
	support.noCloneChecked = !!div.cloneNode( true ).lastChild.defaultValue;
} )();


var
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|pointer|contextmenu|drag|drop)|click/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

// Support: IE9
// See #13393 for more info
function safeActiveElement() {
	try {
		return document.activeElement;
	} catch ( err ) { }
}

function on( elem, types, selector, data, fn, one ) {
	var origFn, type;

	// Types can be a map of types/handlers
	if ( typeof types === "object" ) {

		// ( types-Object, selector, data )
		if ( typeof selector !== "string" ) {

			// ( types-Object, data )
			data = data || selector;
			selector = undefined;
		}
		for ( type in types ) {
			on( elem, type, selector, data, types[ type ], one );
		}
		return elem;
	}

	if ( data == null && fn == null ) {

		// ( types, fn )
		fn = selector;
		data = selector = undefined;
	} else if ( fn == null ) {
		if ( typeof selector === "string" ) {

			// ( types, selector, fn )
			fn = data;
			data = undefined;
		} else {

			// ( types, data, fn )
			fn = data;
			data = selector;
			selector = undefined;
		}
	}
	if ( fn === false ) {
		fn = returnFalse;
	} else if ( !fn ) {
		return elem;
	}

	if ( one === 1 ) {
		origFn = fn;
		fn = function( event ) {

			// Can use an empty set, since event contains the info
			jQuery().off( event );
			return origFn.apply( this, arguments );
		};

		// Use same guid so caller can remove using origFn
		fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
	}
	return elem.each( function() {
		jQuery.event.add( this, types, fn, data, selector );
	} );
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {

		var handleObjIn, eventHandle, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.get( elem );

		// Don't attach events to noData or text/comment nodes (but allow plain objects)
		if ( !elemData ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !( events = elemData.events ) ) {
			events = elemData.events = {};
		}
		if ( !( eventHandle = elemData.handle ) ) {
			eventHandle = elemData.handle = function( e ) {

				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== "undefined" && jQuery.event.triggered !== e.type ?
					jQuery.event.dispatch.apply( elem, arguments ) : undefined;
			};
		}

		// Handle multiple events separated by a space
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// There *must* be a type, no attaching namespace-only handlers
			if ( !type ) {
				continue;
			}

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend( {
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join( "." )
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !( handlers = events[ type ] ) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener if the special events handler returns false
				if ( !special.setup ||
					special.setup.call( elem, data, namespaces, eventHandle ) === false ) {

					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {

		var j, origCount, tmp,
			events, t, handleObj,
			special, handlers, type, namespaces, origType,
			elemData = dataPriv.hasData( elem ) && dataPriv.get( elem );

		if ( !elemData || !( events = elemData.events ) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( rnotwhite ) || [ "" ];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[ t ] ) || [];
			type = origType = tmp[ 1 ];
			namespaces = ( tmp[ 2 ] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[ 2 ] &&
				new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector ||
						selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown ||
					special.teardown.call( elem, namespaces, elemData.handle ) === false ) {

					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove data and the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			dataPriv.remove( elem, "handle events" );
		}
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event );

		var i, j, ret, matched, handleObj,
			handlerQueue = [],
			args = slice.call( arguments ),
			handlers = ( dataPriv.get( this, "events" ) || {} )[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[ 0 ] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( ( matched = handlerQueue[ i++ ] ) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( ( handleObj = matched.handlers[ j++ ] ) &&
				!event.isImmediatePropagationStopped() ) {

				// Triggered event must either 1) have no namespace, or 2) have namespace(s)
				// a subset or equal to those in the bound event (both can have no namespace).
				if ( !event.rnamespace || event.rnamespace.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( ( jQuery.event.special[ handleObj.origType ] || {} ).handle ||
						handleObj.handler ).apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( ( event.result = ret ) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var i, matches, sel, handleObj,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Support (at least): Chrome, IE9
		// Find delegate handlers
		// Black-hole SVG <use> instance trees (#13180)
		//
		// Support: Firefox<=42+
		// Avoid non-left-click in FF but don't block IE radio events (#3861, gh-2343)
		if ( delegateCount && cur.nodeType &&
			( event.type !== "click" || isNaN( event.button ) || event.button < 1 ) ) {

			for ( ; cur !== this; cur = cur.parentNode || this ) {

				// Don't check non-elements (#13208)
				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.nodeType === 1 && ( cur.disabled !== true || event.type !== "click" ) ) {
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matches[ sel ] === undefined ) {
							matches[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) > -1 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matches[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push( { elem: cur, handlers: matches } );
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( delegateCount < handlers.length ) {
			handlerQueue.push( { elem: this, handlers: handlers.slice( delegateCount ) } );
		}

		return handlerQueue;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	props: ( "altKey bubbles cancelable ctrlKey currentTarget detail eventPhase " +
		"metaKey relatedTarget shiftKey target timeStamp view which" ).split( " " ),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split( " " ),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: ( "button buttons clientX clientY offsetX offsetY pageX pageY " +
			"screenX screenY toElement" ).split( " " ),
		filter: function( event, original ) {
			var eventDoc, doc, body,
				button = original.button;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX +
					( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) -
					( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY +
					( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) -
					( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop, copy,
			type = event.type,
			originalEvent = event,
			fixHook = this.fixHooks[ type ];

		if ( !fixHook ) {
			this.fixHooks[ type ] = fixHook =
				rmouseEvent.test( type ) ? this.mouseHooks :
				rkeyEvent.test( type ) ? this.keyHooks :
				{};
		}
		copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = new jQuery.Event( originalEvent );

		i = copy.length;
		while ( i-- ) {
			prop = copy[ i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Support: Cordova 2.5 (WebKit) (#13255)
		// All events should have a target; Cordova deviceready doesn't
		if ( !event.target ) {
			event.target = document;
		}

		// Support: Safari 6.0+, Chrome<28
		// Target should not be a text node (#504, #13143)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		return fixHook.filter ? fixHook.filter( event, originalEvent ) : event;
	},

	special: {
		load: {

			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		focus: {

			// Fire native event if possible so blur/focus sequence is correct
			trigger: function() {
				if ( this !== safeActiveElement() && this.focus ) {
					this.focus();
					return false;
				}
			},
			delegateType: "focusin"
		},
		blur: {
			trigger: function() {
				if ( this === safeActiveElement() && this.blur ) {
					this.blur();
					return false;
				}
			},
			delegateType: "focusout"
		},
		click: {

			// For checkbox, fire native event so checked state will be right
			trigger: function() {
				if ( this.type === "checkbox" && this.click && jQuery.nodeName( this, "input" ) ) {
					this.click();
					return false;
				}
			},

			// For cross-browser consistency, don't fire native .click() on links
			_default: function( event ) {
				return jQuery.nodeName( event.target, "a" );
			}
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Support: Firefox 20+
				// Firefox doesn't alert if the returnValue field is not set.
				if ( event.result !== undefined && event.originalEvent ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	}
};

jQuery.removeEvent = function( elem, type, handle ) {

	// This "if" is needed for plain objects
	if ( elem.removeEventListener ) {
		elem.removeEventListener( type, handle );
	}
};

jQuery.Event = function( src, props ) {

	// Allow instantiation without the 'new' keyword
	if ( !( this instanceof jQuery.Event ) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = src.defaultPrevented ||
				src.defaultPrevented === undefined &&

				// Support: Android<4.0
				src.returnValue === false ?
			returnTrue :
			returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	constructor: jQuery.Event,
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;

		if ( e ) {
			e.preventDefault();
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;

		if ( e ) {
			e.stopPropagation();
		}
	},
	stopImmediatePropagation: function() {
		var e = this.originalEvent;

		this.isImmediatePropagationStopped = returnTrue;

		if ( e ) {
			e.stopImmediatePropagation();
		}

		this.stopPropagation();
	}
};

// Create mouseenter/leave events using mouseover/out and event-time checks
// so that event delegation works in jQuery.
// Do the same for pointerenter/pointerleave and pointerover/pointerout
//
// Support: Safari 7 only
// Safari sends mouseenter too often; see:
// https://code.google.com/p/chromium/issues/detail?id=470258
// for the description of the bug (it existed in older Chrome versions as well).
jQuery.each( {
	mouseenter: "mouseover",
	mouseleave: "mouseout",
	pointerenter: "pointerover",
	pointerleave: "pointerout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mouseenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || ( related !== target && !jQuery.contains( target, related ) ) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
} );

jQuery.fn.extend( {
	on: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn );
	},
	one: function( types, selector, data, fn ) {
		return on( this, types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {

			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ?
					handleObj.origType + "." + handleObj.namespace :
					handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {

			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {

			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each( function() {
			jQuery.event.remove( this, types, fn, selector );
		} );
	}
} );


var
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:-]+)[^>]*)\/>/gi,

	// Support: IE 10-11, Edge 10240+
	// In IE/Edge using regex groups here causes severe slowdowns.
	// See https://connect.microsoft.com/IE/feedback/details/1736512/
	rnoInnerhtml = /<script|<style|<link/i,

	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptTypeMasked = /^true\/(.*)/,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g;

// Manipulating tables requires a tbody
function manipulationTarget( elem, content ) {
	return jQuery.nodeName( elem, "table" ) &&
		jQuery.nodeName( content.nodeType !== 11 ? content : content.firstChild, "tr" ) ?

		elem.getElementsByTagName( "tbody" )[ 0 ] ||
			elem.appendChild( elem.ownerDocument.createElement( "tbody" ) ) :
		elem;
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	elem.type = ( elem.getAttribute( "type" ) !== null ) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	var match = rscriptTypeMasked.exec( elem.type );

	if ( match ) {
		elem.type = match[ 1 ];
	} else {
		elem.removeAttribute( "type" );
	}

	return elem;
}

function cloneCopyEvent( src, dest ) {
	var i, l, type, pdataOld, pdataCur, udataOld, udataCur, events;

	if ( dest.nodeType !== 1 ) {
		return;
	}

	// 1. Copy private data: events, handlers, etc.
	if ( dataPriv.hasData( src ) ) {
		pdataOld = dataPriv.access( src );
		pdataCur = dataPriv.set( dest, pdataOld );
		events = pdataOld.events;

		if ( events ) {
			delete pdataCur.handle;
			pdataCur.events = {};

			for ( type in events ) {
				for ( i = 0, l = events[ type ].length; i < l; i++ ) {
					jQuery.event.add( dest, type, events[ type ][ i ] );
				}
			}
		}
	}

	// 2. Copy user data
	if ( dataUser.hasData( src ) ) {
		udataOld = dataUser.access( src );
		udataCur = jQuery.extend( {}, udataOld );

		dataUser.set( dest, udataCur );
	}
}

// Fix IE bugs, see support tests
function fixInput( src, dest ) {
	var nodeName = dest.nodeName.toLowerCase();

	// Fails to persist the checked state of a cloned checkbox or radio button.
	if ( nodeName === "input" && rcheckableType.test( src.type ) ) {
		dest.checked = src.checked;

	// Fails to return the selected option to the default selected state when cloning options
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

function domManip( collection, args, callback, ignored ) {

	// Flatten any nested arrays
	args = concat.apply( [], args );

	var fragment, first, scripts, hasScripts, node, doc,
		i = 0,
		l = collection.length,
		iNoClone = l - 1,
		value = args[ 0 ],
		isFunction = jQuery.isFunction( value );

	// We can't cloneNode fragments that contain checked, in WebKit
	if ( isFunction ||
			( l > 1 && typeof value === "string" &&
				!support.checkClone && rchecked.test( value ) ) ) {
		return collection.each( function( index ) {
			var self = collection.eq( index );
			if ( isFunction ) {
				args[ 0 ] = value.call( this, index, self.html() );
			}
			domManip( self, args, callback, ignored );
		} );
	}

	if ( l ) {
		fragment = buildFragment( args, collection[ 0 ].ownerDocument, false, collection, ignored );
		first = fragment.firstChild;

		if ( fragment.childNodes.length === 1 ) {
			fragment = first;
		}

		// Require either new content or an interest in ignored elements to invoke the callback
		if ( first || ignored ) {
			scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
			hasScripts = scripts.length;

			// Use the original fragment for the last item
			// instead of the first because it can end up
			// being emptied incorrectly in certain situations (#8070).
			for ( ; i < l; i++ ) {
				node = fragment;

				if ( i !== iNoClone ) {
					node = jQuery.clone( node, true, true );

					// Keep references to cloned scripts for later restoration
					if ( hasScripts ) {

						// Support: Android<4.1, PhantomJS<2
						// push.apply(_, arraylike) throws on ancient WebKit
						jQuery.merge( scripts, getAll( node, "script" ) );
					}
				}

				callback.call( collection[ i ], node, i );
			}

			if ( hasScripts ) {
				doc = scripts[ scripts.length - 1 ].ownerDocument;

				// Reenable scripts
				jQuery.map( scripts, restoreScript );

				// Evaluate executable scripts on first document insertion
				for ( i = 0; i < hasScripts; i++ ) {
					node = scripts[ i ];
					if ( rscriptType.test( node.type || "" ) &&
						!dataPriv.access( node, "globalEval" ) &&
						jQuery.contains( doc, node ) ) {

						if ( node.src ) {

							// Optional AJAX dependency, but won't run scripts if not present
							if ( jQuery._evalUrl ) {
								jQuery._evalUrl( node.src );
							}
						} else {
							jQuery.globalEval( node.textContent.replace( rcleanScript, "" ) );
						}
					}
				}
			}
		}
	}

	return collection;
}

function remove( elem, selector, keepData ) {
	var node,
		nodes = selector ? jQuery.filter( selector, elem ) : elem,
		i = 0;

	for ( ; ( node = nodes[ i ] ) != null; i++ ) {
		if ( !keepData && node.nodeType === 1 ) {
			jQuery.cleanData( getAll( node ) );
		}

		if ( node.parentNode ) {
			if ( keepData && jQuery.contains( node.ownerDocument, node ) ) {
				setGlobalEval( getAll( node, "script" ) );
			}
			node.parentNode.removeChild( node );
		}
	}

	return elem;
}

jQuery.extend( {
	htmlPrefilter: function( html ) {
		return html.replace( rxhtmlTag, "<$1></$2>" );
	},

	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var i, l, srcElements, destElements,
			clone = elem.cloneNode( true ),
			inPage = jQuery.contains( elem.ownerDocument, elem );

		// Fix IE cloning issues
		if ( !support.noCloneChecked && ( elem.nodeType === 1 || elem.nodeType === 11 ) &&
				!jQuery.isXMLDoc( elem ) ) {

			// We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			for ( i = 0, l = srcElements.length; i < l; i++ ) {
				fixInput( srcElements[ i ], destElements[ i ] );
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0, l = srcElements.length; i < l; i++ ) {
					cloneCopyEvent( srcElements[ i ], destElements[ i ] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		// Return the cloned set
		return clone;
	},

	cleanData: function( elems ) {
		var data, elem, type,
			special = jQuery.event.special,
			i = 0;

		for ( ; ( elem = elems[ i ] ) !== undefined; i++ ) {
			if ( acceptData( elem ) ) {
				if ( ( data = elem[ dataPriv.expando ] ) ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Support: Chrome <= 35-45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataPriv.expando ] = undefined;
				}
				if ( elem[ dataUser.expando ] ) {

					// Support: Chrome <= 35-45+
					// Assign undefined instead of using delete, see Data#remove
					elem[ dataUser.expando ] = undefined;
				}
			}
		}
	}
} );

jQuery.fn.extend( {

	// Keep domManip exposed until 3.0 (gh-2225)
	domManip: domManip,

	detach: function( selector ) {
		return remove( this, selector, true );
	},

	remove: function( selector ) {
		return remove( this, selector );
	},

	text: function( value ) {
		return access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().each( function() {
					if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
						this.textContent = value;
					}
				} );
		}, null, value, arguments.length );
	},

	append: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.appendChild( elem );
			}
		} );
	},

	prepend: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				var target = manipulationTarget( this, elem );
				target.insertBefore( elem, target.firstChild );
			}
		} );
	},

	before: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		} );
	},

	after: function() {
		return domManip( this, arguments, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		} );
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; ( elem = this[ i ] ) != null; i++ ) {
			if ( elem.nodeType === 1 ) {

				// Prevent memory leaks
				jQuery.cleanData( getAll( elem, false ) );

				// Remove any remaining nodes
				elem.textContent = "";
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function() {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		} );
	},

	html: function( value ) {
		return access( this, function( value ) {
			var elem = this[ 0 ] || {},
				i = 0,
				l = this.length;

			if ( value === undefined && elem.nodeType === 1 ) {
				return elem.innerHTML;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				!wrapMap[ ( rtagName.exec( value ) || [ "", "" ] )[ 1 ].toLowerCase() ] ) {

				value = jQuery.htmlPrefilter( value );

				try {
					for ( ; i < l; i++ ) {
						elem = this[ i ] || {};

						// Remove element nodes and prevent memory leaks
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch ( e ) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function() {
		var ignored = [];

		// Make the changes, replacing each non-ignored context element with the new content
		return domManip( this, arguments, function( elem ) {
			var parent = this.parentNode;

			if ( jQuery.inArray( this, ignored ) < 0 ) {
				jQuery.cleanData( getAll( this ) );
				if ( parent ) {
					parent.replaceChild( elem, this );
				}
			}

		// Force callback invocation
		}, ignored );
	}
} );

jQuery.each( {
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1,
			i = 0;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone( true );
			jQuery( insert[ i ] )[ original ]( elems );

			// Support: QtWebKit
			// .get() because push.apply(_, arraylike) throws
			push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
} );


var iframe,
	elemdisplay = {

		// Support: Firefox
		// We have to pre-define these values for FF (#10227)
		HTML: "block",
		BODY: "block"
	};

/**
 * Retrieve the actual display of a element
 * @param {String} name nodeName of the element
 * @param {Object} doc Document object
 */

// Called only from within defaultDisplay
function actualDisplay( name, doc ) {
	var elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),

		display = jQuery.css( elem[ 0 ], "display" );

	// We don't have any data stored on the element,
	// so use "detach" method as fast way to get rid of the element
	elem.detach();

	return display;
}

/**
 * Try to determine the default display value of an element
 * @param {String} nodeName
 */
function defaultDisplay( nodeName ) {
	var doc = document,
		display = elemdisplay[ nodeName ];

	if ( !display ) {
		display = actualDisplay( nodeName, doc );

		// If the simple way fails, read from inside an iframe
		if ( display === "none" || !display ) {

			// Use the already-created iframe if possible
			iframe = ( iframe || jQuery( "<iframe frameborder='0' width='0' height='0'/>" ) )
				.appendTo( doc.documentElement );

			// Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
			doc = iframe[ 0 ].contentDocument;

			// Support: IE
			doc.write();
			doc.close();

			display = actualDisplay( nodeName, doc );
			iframe.detach();
		}

		// Store the correct default display
		elemdisplay[ nodeName ] = display;
	}

	return display;
}
var rmargin = ( /^margin/ );

var rnumnonpx = new RegExp( "^(" + pnum + ")(?!px)[a-z%]+$", "i" );

var getStyles = function( elem ) {

		// Support: IE<=11+, Firefox<=30+ (#15098, #14150)
		// IE throws on elements created in popups
		// FF meanwhile throws on frame elements through "defaultView.getComputedStyle"
		var view = elem.ownerDocument.defaultView;

		if ( !view || !view.opener ) {
			view = window;
		}

		return view.getComputedStyle( elem );
	};

var swap = function( elem, options, callback, args ) {
	var ret, name,
		old = {};

	// Remember the old values, and insert the new ones
	for ( name in options ) {
		old[ name ] = elem.style[ name ];
		elem.style[ name ] = options[ name ];
	}

	ret = callback.apply( elem, args || [] );

	// Revert the old values
	for ( name in options ) {
		elem.style[ name ] = old[ name ];
	}

	return ret;
};


var documentElement = document.documentElement;



( function() {
	var pixelPositionVal, boxSizingReliableVal, pixelMarginRightVal, reliableMarginLeftVal,
		container = document.createElement( "div" ),
		div = document.createElement( "div" );

	// Finish early in limited (non-browser) environments
	if ( !div.style ) {
		return;
	}

	// Support: IE9-11+
	// Style of cloned element affects source element cloned (#8908)
	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	container.style.cssText = "border:0;width:8px;height:0;top:0;left:-9999px;" +
		"padding:0;margin-top:1px;position:absolute";
	container.appendChild( div );

	// Executing both pixelPosition & boxSizingReliable tests require only one layout
	// so they're executed at the same time to save the second computation.
	function computeStyleTests() {
		div.style.cssText =

			// Support: Firefox<29, Android 2.3
			// Vendor-prefix box-sizing
			"-webkit-box-sizing:border-box;-moz-box-sizing:border-box;box-sizing:border-box;" +
			"position:relative;display:block;" +
			"margin:auto;border:1px;padding:1px;" +
			"top:1%;width:50%";
		div.innerHTML = "";
		documentElement.appendChild( container );

		var divStyle = window.getComputedStyle( div );
		pixelPositionVal = divStyle.top !== "1%";
		reliableMarginLeftVal = divStyle.marginLeft === "2px";
		boxSizingReliableVal = divStyle.width === "4px";

		// Support: Android 4.0 - 4.3 only
		// Some styles come back with percentage values, even though they shouldn't
		div.style.marginRight = "50%";
		pixelMarginRightVal = divStyle.marginRight === "4px";

		documentElement.removeChild( container );
	}

	jQuery.extend( support, {
		pixelPosition: function() {

			// This test is executed only once but we still do memoizing
			// since we can use the boxSizingReliable pre-computing.
			// No need to check if the test was already performed, though.
			computeStyleTests();
			return pixelPositionVal;
		},
		boxSizingReliable: function() {
			if ( boxSizingReliableVal == null ) {
				computeStyleTests();
			}
			return boxSizingReliableVal;
		},
		pixelMarginRight: function() {

			// Support: Android 4.0-4.3
			// We're checking for boxSizingReliableVal here instead of pixelMarginRightVal
			// since that compresses better and they're computed together anyway.
			if ( boxSizingReliableVal == null ) {
				computeStyleTests();
			}
			return pixelMarginRightVal;
		},
		reliableMarginLeft: function() {

			// Support: IE <=8 only, Android 4.0 - 4.3 only, Firefox <=3 - 37
			if ( boxSizingReliableVal == null ) {
				computeStyleTests();
			}
			return reliableMarginLeftVal;
		},
		reliableMarginRight: function() {

			// Support: Android 2.3
			// Check if div with explicit width and no margin-right incorrectly
			// gets computed margin-right based on width of container. (#3333)
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			// This support function is only executed once so no memoizing is needed.
			var ret,
				marginDiv = div.appendChild( document.createElement( "div" ) );

			// Reset CSS: box-sizing; display; margin; border; padding
			marginDiv.style.cssText = div.style.cssText =

				// Support: Android 2.3
				// Vendor-prefix box-sizing
				"-webkit-box-sizing:content-box;box-sizing:content-box;" +
				"display:block;margin:0;border:0;padding:0";
			marginDiv.style.marginRight = marginDiv.style.width = "0";
			div.style.width = "1px";
			documentElement.appendChild( container );

			ret = !parseFloat( window.getComputedStyle( marginDiv ).marginRight );

			documentElement.removeChild( container );
			div.removeChild( marginDiv );

			return ret;
		}
	} );
} )();


function curCSS( elem, name, computed ) {
	var width, minWidth, maxWidth, ret,
		style = elem.style;

	computed = computed || getStyles( elem );
	ret = computed ? computed.getPropertyValue( name ) || computed[ name ] : undefined;

	// Support: Opera 12.1x only
	// Fall back to style even without computed
	// computed is undefined for elems on document fragments
	if ( ( ret === "" || ret === undefined ) && !jQuery.contains( elem.ownerDocument, elem ) ) {
		ret = jQuery.style( elem, name );
	}

	// Support: IE9
	// getPropertyValue is only needed for .css('filter') (#12537)
	if ( computed ) {

		// A tribute to the "awesome hack by Dean Edwards"
		// Android Browser returns percentage for some values,
		// but width seems to be reliably pixels.
		// This is against the CSSOM draft spec:
		// http://dev.w3.org/csswg/cssom/#resolved-values
		if ( !support.pixelMarginRight() && rnumnonpx.test( ret ) && rmargin.test( name ) ) {

			// Remember the original values
			width = style.width;
			minWidth = style.minWidth;
			maxWidth = style.maxWidth;

			// Put in the new values to get a computed value out
			style.minWidth = style.maxWidth = style.width = ret;
			ret = computed.width;

			// Revert the changed values
			style.width = width;
			style.minWidth = minWidth;
			style.maxWidth = maxWidth;
		}
	}

	return ret !== undefined ?

		// Support: IE9-11+
		// IE returns zIndex value as an integer.
		ret + "" :
		ret;
}


function addGetHookIf( conditionFn, hookFn ) {

	// Define the hook, we'll check on the first run if it's really needed.
	return {
		get: function() {
			if ( conditionFn() ) {

				// Hook not needed (or it's not possible to use it due
				// to missing dependency), remove it.
				delete this.get;
				return;
			}

			// Hook needed; redefine it so that the support test is not executed again.
			return ( this.get = hookFn ).apply( this, arguments );
		}
	};
}


var

	// Swappable if display is none or starts with table
	// except "table", "table-cell", or "table-caption"
	// See here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: "0",
		fontWeight: "400"
	},

	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ],
	emptyStyle = document.createElement( "div" ).style;

// Return a css property mapped to a potentially vendor prefixed property
function vendorPropName( name ) {

	// Shortcut for names that are not vendor prefixed
	if ( name in emptyStyle ) {
		return name;
	}

	// Check for vendor prefixed names
	var capName = name[ 0 ].toUpperCase() + name.slice( 1 ),
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in emptyStyle ) {
			return name;
		}
	}
}

function setPositiveNumber( elem, value, subtract ) {

	// Any relative (+/-) values have already been
	// normalized at this point
	var matches = rcssNum.exec( value );
	return matches ?

		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 2 ] - ( subtract || 0 ) ) + ( matches[ 3 ] || "px" ) :
		value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?

		// If we already have the right measurement, avoid augmentation
		4 :

		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {

		// Both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
		}

		if ( isBorderBox ) {

			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// At this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		} else {

			// At this point, extra isn't content, so add padding
			val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// At this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var valueIsBorderBox = true,
		val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		styles = getStyles( elem ),
		isBorderBox = jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

	// Support: IE11 only
	// In IE 11 fullscreen elements inside of an iframe have
	// 100x too small dimensions (gh-1764).
	if ( document.msFullscreenElement && window.top !== window ) {

		// Support: IE11 only
		// Running getBoundingClientRect on a disconnected node
		// in IE throws an error.
		if ( elem.getClientRects().length ) {
			val = Math.round( elem.getBoundingClientRect()[ name ] * 100 );
		}
	}

	// Some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {

		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name, styles );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test( val ) ) {
			return val;
		}

		// Check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox &&
			( support.boxSizingReliable() || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// Use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles
		)
	) + "px";
}

function showHide( elements, show ) {
	var display, elem, hidden,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		values[ index ] = dataPriv.get( elem, "olddisplay" );
		display = elem.style.display;
		if ( show ) {

			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = dataPriv.access(
					elem,
					"olddisplay",
					defaultDisplay( elem.nodeName )
				);
			}
		} else {
			hidden = isHidden( elem );

			if ( display !== "none" || !hidden ) {
				dataPriv.set(
					elem,
					"olddisplay",
					hidden ? display : jQuery.css( elem, "display" )
				);
			}
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

jQuery.extend( {

	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {

					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Don't automatically add "px" to these possibly-unitless properties
	cssNumber: {
		"animationIterationCount": true,
		"columnCount": true,
		"fillOpacity": true,
		"flexGrow": true,
		"flexShrink": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"order": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		"float": "cssFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {

		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] ||
			( jQuery.cssProps[ origName ] = vendorPropName( origName ) || origName );

		// Gets hook for the prefixed version, then unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// Convert "+=" or "-=" to relative numbers (#7345)
			if ( type === "string" && ( ret = rcssNum.exec( value ) ) && ret[ 1 ] ) {
				value = adjustCSS( elem, name, ret );

				// Fixes bug #9237
				type = "number";
			}

			// Make sure that null and NaN values aren't set (#7116)
			if ( value == null || value !== value ) {
				return;
			}

			// If a number was passed in, add the unit (except for certain CSS properties)
			if ( type === "number" ) {
				value += ret && ret[ 3 ] || ( jQuery.cssNumber[ origName ] ? "" : "px" );
			}

			// Support: IE9-11+
			// background-* props affect original clone's values
			if ( !support.clearCloneStyle && value === "" && name.indexOf( "background" ) === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !( "set" in hooks ) ||
				( value = hooks.set( elem, value, extra ) ) !== undefined ) {

				style[ name ] = value;
			}

		} else {

			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks &&
				( ret = hooks.get( elem, false, extra ) ) !== undefined ) {

				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var val, num, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] ||
			( jQuery.cssProps[ origName ] = vendorPropName( origName ) || origName );

		// Try prefixed name followed by the unprefixed name
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		// Convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Make numeric if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || isFinite( num ) ? num || 0 : val;
		}
		return val;
	}
} );

jQuery.each( [ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {

				// Certain elements can have dimension info if we invisibly show them
				// but it must have a current display style that would benefit
				return rdisplayswap.test( jQuery.css( elem, "display" ) ) &&
					elem.offsetWidth === 0 ?
						swap( elem, cssShow, function() {
							return getWidthOrHeight( elem, name, extra );
						} ) :
						getWidthOrHeight( elem, name, extra );
			}
		},

		set: function( elem, value, extra ) {
			var matches,
				styles = extra && getStyles( elem ),
				subtract = extra && augmentWidthOrHeight(
					elem,
					name,
					extra,
					jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
					styles
				);

			// Convert to pixels if value adjustment is needed
			if ( subtract && ( matches = rcssNum.exec( value ) ) &&
				( matches[ 3 ] || "px" ) !== "px" ) {

				elem.style[ name ] = value;
				value = jQuery.css( elem, name );
			}

			return setPositiveNumber( elem, value, subtract );
		}
	};
} );

jQuery.cssHooks.marginLeft = addGetHookIf( support.reliableMarginLeft,
	function( elem, computed ) {
		if ( computed ) {
			return ( parseFloat( curCSS( elem, "marginLeft" ) ) ||
				elem.getBoundingClientRect().left -
					swap( elem, { marginLeft: 0 }, function() {
						return elem.getBoundingClientRect().left;
					} )
				) + "px";
		}
	}
);

// Support: Android 2.3
jQuery.cssHooks.marginRight = addGetHookIf( support.reliableMarginRight,
	function( elem, computed ) {
		if ( computed ) {
			return swap( elem, { "display": "inline-block" },
				curCSS, [ elem, "marginRight" ] );
		}
	}
);

// These hooks are used by animate to expand properties
jQuery.each( {
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// Assumes a single number if not a string
				parts = typeof value === "string" ? value.split( " " ) : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
} );

jQuery.fn.extend( {
	css: function( name, value ) {
		return access( this, function( elem, name, value ) {
			var styles, len,
				map = {},
				i = 0;

			if ( jQuery.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		if ( typeof state === "boolean" ) {
			return state ? this.show() : this.hide();
		}

		return this.each( function() {
			if ( isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		} );
	}
} );


function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || jQuery.easing._default;
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			// Use a property on the element directly when it is not a DOM element,
			// or when there is no matching style property that exists.
			if ( tween.elem.nodeType !== 1 ||
				tween.elem[ tween.prop ] != null && tween.elem.style[ tween.prop ] == null ) {
				return tween.elem[ tween.prop ];
			}

			// Passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails.
			// Simple values such as "10px" are parsed to Float;
			// complex values such as "rotate(1rad)" are returned as-is.
			result = jQuery.css( tween.elem, tween.prop, "" );

			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {

			// Use step hook for back compat.
			// Use cssHook if its there.
			// Use .style if available and use plain properties where available.
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.nodeType === 1 &&
				( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null ||
					jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Support: IE9
// Panic based approach to setting things on disconnected nodes
Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p * Math.PI ) / 2;
	},
	_default: "swing"
};

jQuery.fx = Tween.prototype.init;

// Back Compat <1.8 extension point
jQuery.fx.step = {};




var
	fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rrun = /queueHooks$/;

// Animations created synchronously will run synchronously
function createFxNow() {
	window.setTimeout( function() {
		fxNow = undefined;
	} );
	return ( fxNow = jQuery.now() );
}

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		i = 0,
		attrs = { height: type };

	// If we include width, step value is 1 to do all cssExpand values,
	// otherwise step value is 2 to skip over Left and Right
	includeWidth = includeWidth ? 1 : 0;
	for ( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

function createTween( value, prop, animation ) {
	var tween,
		collection = ( Animation.tweeners[ prop ] || [] ).concat( Animation.tweeners[ "*" ] ),
		index = 0,
		length = collection.length;
	for ( ; index < length; index++ ) {
		if ( ( tween = collection[ index ].call( animation, prop, value ) ) ) {

			// We're done with this property
			return tween;
		}
	}
}

function defaultPrefilter( elem, props, opts ) {
	/* jshint validthis: true */
	var prop, value, toggle, tween, hooks, oldfire, display, checkDisplay,
		anim = this,
		orig = {},
		style = elem.style,
		hidden = elem.nodeType && isHidden( elem ),
		dataShow = dataPriv.get( elem, "fxshow" );

	// Handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always( function() {

			// Ensure the complete handler is called before this completes
			anim.always( function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			} );
		} );
	}

	// Height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {

		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE9-10 do not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		display = jQuery.css( elem, "display" );

		// Test default display if display is currently "none"
		checkDisplay = display === "none" ?
			dataPriv.get( elem, "olddisplay" ) || defaultDisplay( elem.nodeName ) : display;

		if ( checkDisplay === "inline" && jQuery.css( elem, "float" ) === "none" ) {
			style.display = "inline-block";
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		anim.always( function() {
			style.overflow = opts.overflow[ 0 ];
			style.overflowX = opts.overflow[ 1 ];
			style.overflowY = opts.overflow[ 2 ];
		} );
	}

	// show/hide pass
	for ( prop in props ) {
		value = props[ prop ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ prop ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {

				// If there is dataShow left over from a stopped hide or show
				// and we are going to proceed with show, we should pretend to be hidden
				if ( value === "show" && dataShow && dataShow[ prop ] !== undefined ) {
					hidden = true;
				} else {
					continue;
				}
			}
			orig[ prop ] = dataShow && dataShow[ prop ] || jQuery.style( elem, prop );

		// Any non-fx value stops us from restoring the original display value
		} else {
			display = undefined;
		}
	}

	if ( !jQuery.isEmptyObject( orig ) ) {
		if ( dataShow ) {
			if ( "hidden" in dataShow ) {
				hidden = dataShow.hidden;
			}
		} else {
			dataShow = dataPriv.access( elem, "fxshow", {} );
		}

		// Store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done( function() {
				jQuery( elem ).hide();
			} );
		}
		anim.done( function() {
			var prop;

			dataPriv.remove( elem, "fxshow" );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		} );
		for ( prop in orig ) {
			tween = createTween( hidden ? dataShow[ prop ] : 0, prop, anim );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}

	// If this is a noop like .hide().hide(), restore an overwritten display value
	} else if ( ( display === "none" ? defaultDisplay( elem.nodeName ) : display ) === "inline" ) {
		style.display = display;
	}
}

function propFilter( props, specialEasing ) {
	var index, name, easing, value, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// Not quite $.extend, this won't overwrite existing keys.
			// Reusing 'index' because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = Animation.prefilters.length,
		deferred = jQuery.Deferred().always( function() {

			// Don't match elem in the :animated selector
			delete tick.elem;
		} ),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),

				// Support: Android 2.3
				// Archaic crash bug won't allow us to use `1 - ( 0.5 || 0 )` (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ] );

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise( {
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, {
				specialEasing: {},
				easing: jQuery.easing._default
			}, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,

					// If we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// Resolve when we played the last frame; otherwise, reject
				if ( gotoEnd ) {
					deferred.notifyWith( elem, [ animation, 1, 0 ] );
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		} ),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = Animation.prefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			if ( jQuery.isFunction( result.stop ) ) {
				jQuery._queueHooks( animation.elem, animation.opts.queue ).stop =
					jQuery.proxy( result.stop, result );
			}
			return result;
		}
	}

	jQuery.map( props, createTween, animation );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		} )
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

jQuery.Animation = jQuery.extend( Animation, {
	tweeners: {
		"*": [ function( prop, value ) {
			var tween = this.createTween( prop, value );
			adjustCSS( tween.elem, prop, rcssNum.exec( value ), tween );
			return tween;
		} ]
	},

	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.match( rnotwhite );
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			Animation.tweeners[ prop ] = Animation.tweeners[ prop ] || [];
			Animation.tweeners[ prop ].unshift( callback );
		}
	},

	prefilters: [ defaultPrefilter ],

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			Animation.prefilters.unshift( callback );
		} else {
			Animation.prefilters.push( callback );
		}
	}
} );

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ?
		opt.duration : opt.duration in jQuery.fx.speeds ?
			jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// Normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.fn.extend( {
	fadeTo: function( speed, to, easing, callback ) {

		// Show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// Animate to the value specified
			.end().animate( { opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {

				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );

				// Empty animations, or finishing resolves immediately
				if ( empty || dataPriv.get( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each( function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = dataPriv.get( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this &&
					( type == null || timers[ index ].queue === type ) ) {

					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// Start the next in the queue if the last step wasn't forced.
			// Timers currently will call their complete callbacks, which
			// will dequeue but only if they were gotoEnd.
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		} );
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each( function() {
			var index,
				data = dataPriv.get( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// Enable finishing flag on private data
			data.finish = true;

			// Empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.stop ) {
				hooks.stop.call( this, true );
			}

			// Look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// Look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// Turn off finishing flag
			delete data.finish;
		} );
	}
} );

jQuery.each( [ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
} );

// Generate shortcuts for custom animations
jQuery.each( {
	slideDown: genFx( "show" ),
	slideUp: genFx( "hide" ),
	slideToggle: genFx( "toggle" ),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
} );

jQuery.timers = [];
jQuery.fx.tick = function() {
	var timer,
		i = 0,
		timers = jQuery.timers;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];

		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	jQuery.timers.push( timer );
	if ( timer() ) {
		jQuery.fx.start();
	} else {
		jQuery.timers.pop();
	}
};

jQuery.fx.interval = 13;
jQuery.fx.start = function() {
	if ( !timerId ) {
		timerId = window.setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.stop = function() {
	window.clearInterval( timerId );

	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,

	// Default speed
	_default: 400
};


// Based off of the plugin by Clint Helfers, with permission.
// http://web.archive.org/web/20100324014747/http://blindsignals.com/index.php/2009/07/jquery-delay/
jQuery.fn.delay = function( time, type ) {
	time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
	type = type || "fx";

	return this.queue( type, function( next, hooks ) {
		var timeout = window.setTimeout( next, time );
		hooks.stop = function() {
			window.clearTimeout( timeout );
		};
	} );
};


( function() {
	var input = document.createElement( "input" ),
		select = document.createElement( "select" ),
		opt = select.appendChild( document.createElement( "option" ) );

	input.type = "checkbox";

	// Support: iOS<=5.1, Android<=4.2+
	// Default value for a checkbox should be "on"
	support.checkOn = input.value !== "";

	// Support: IE<=11+
	// Must access selectedIndex to make default options select
	support.optSelected = opt.selected;

	// Support: Android<=2.3
	// Options inside disabled selects are incorrectly marked as disabled
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Support: IE<=11+
	// An input loses its value after becoming a radio
	input = document.createElement( "input" );
	input.value = "t";
	input.type = "radio";
	support.radioValue = input.value === "t";
} )();


var boolHook,
	attrHandle = jQuery.expr.attrHandle;

jQuery.fn.extend( {
	attr: function( name, value ) {
		return access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each( function() {
			jQuery.removeAttr( this, name );
		} );
	}
} );

jQuery.extend( {
	attr: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set attributes on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === "undefined" ) {
			return jQuery.prop( elem, name, value );
		}

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] ||
				( jQuery.expr.match.bool.test( name ) ? boolHook : undefined );
		}

		if ( value !== undefined ) {
			if ( value === null ) {
				jQuery.removeAttr( elem, name );
				return;
			}

			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			elem.setAttribute( name, value + "" );
			return value;
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		ret = jQuery.find.attr( elem, name );

		// Non-existent attributes return null, we normalize to undefined
		return ret == null ? undefined : ret;
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !support.radioValue && value === "radio" &&
					jQuery.nodeName( elem, "input" ) ) {
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	},

	removeAttr: function( elem, value ) {
		var name, propName,
			i = 0,
			attrNames = value && value.match( rnotwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( ( name = attrNames[ i++ ] ) ) {
				propName = jQuery.propFix[ name ] || name;

				// Boolean attributes get special treatment (#10870)
				if ( jQuery.expr.match.bool.test( name ) ) {

					// Set corresponding property to false
					elem[ propName ] = false;
				}

				elem.removeAttribute( name );
			}
		}
	}
} );

// Hooks for boolean attributes
boolHook = {
	set: function( elem, value, name ) {
		if ( value === false ) {

			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else {
			elem.setAttribute( name, name );
		}
		return name;
	}
};
jQuery.each( jQuery.expr.match.bool.source.match( /\w+/g ), function( i, name ) {
	var getter = attrHandle[ name ] || jQuery.find.attr;

	attrHandle[ name ] = function( elem, name, isXML ) {
		var ret, handle;
		if ( !isXML ) {

			// Avoid an infinite loop by temporarily removing this function from the getter
			handle = attrHandle[ name ];
			attrHandle[ name ] = ret;
			ret = getter( elem, name, isXML ) != null ?
				name.toLowerCase() :
				null;
			attrHandle[ name ] = handle;
		}
		return ret;
	};
} );




var rfocusable = /^(?:input|select|textarea|button)$/i,
	rclickable = /^(?:a|area)$/i;

jQuery.fn.extend( {
	prop: function( name, value ) {
		return access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		return this.each( function() {
			delete this[ jQuery.propFix[ name ] || name ];
		} );
	}
} );

jQuery.extend( {
	prop: function( elem, name, value ) {
		var ret, hooks,
			nType = elem.nodeType;

		// Don't get/set properties on text, comment and attribute nodes
		if ( nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		if ( nType !== 1 || !jQuery.isXMLDoc( elem ) ) {

			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			if ( hooks && "set" in hooks &&
				( ret = hooks.set( elem, value, name ) ) !== undefined ) {
				return ret;
			}

			return ( elem[ name ] = value );
		}

		if ( hooks && "get" in hooks && ( ret = hooks.get( elem, name ) ) !== null ) {
			return ret;
		}

		return elem[ name ];
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {

				// elem.tabIndex doesn't always return the
				// correct value when it hasn't been explicitly set
				// http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				// Use proper attribute retrieval(#12072)
				var tabindex = jQuery.find.attr( elem, "tabindex" );

				return tabindex ?
					parseInt( tabindex, 10 ) :
					rfocusable.test( elem.nodeName ) ||
						rclickable.test( elem.nodeName ) && elem.href ?
							0 :
							-1;
			}
		}
	},

	propFix: {
		"for": "htmlFor",
		"class": "className"
	}
} );

// Support: IE <=11 only
// Accessing the selectedIndex property
// forces the browser to respect setting selected
// on the option
// The getter ensures a default option is selected
// when in an optgroup
if ( !support.optSelected ) {
	jQuery.propHooks.selected = {
		get: function( elem ) {
			var parent = elem.parentNode;
			if ( parent && parent.parentNode ) {
				parent.parentNode.selectedIndex;
			}
			return null;
		},
		set: function( elem ) {
			var parent = elem.parentNode;
			if ( parent ) {
				parent.selectedIndex;

				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
		}
	};
}

jQuery.each( [
	"tabIndex",
	"readOnly",
	"maxLength",
	"cellSpacing",
	"cellPadding",
	"rowSpan",
	"colSpan",
	"useMap",
	"frameBorder",
	"contentEditable"
], function() {
	jQuery.propFix[ this.toLowerCase() ] = this;
} );




var rclass = /[\t\r\n\f]/g;

function getClass( elem ) {
	return elem.getAttribute && elem.getAttribute( "class" ) || "";
}

jQuery.fn.extend( {
	addClass: function( value ) {
		var classes, elem, cur, curValue, clazz, j, finalValue,
			i = 0;

		if ( jQuery.isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).addClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		if ( typeof value === "string" && value ) {
			classes = value.match( rnotwhite ) || [];

			while ( ( elem = this[ i++ ] ) ) {
				curValue = getClass( elem );
				cur = elem.nodeType === 1 &&
					( " " + curValue + " " ).replace( rclass, " " );

				if ( cur ) {
					j = 0;
					while ( ( clazz = classes[ j++ ] ) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = jQuery.trim( cur );
					if ( curValue !== finalValue ) {
						elem.setAttribute( "class", finalValue );
					}
				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, curValue, clazz, j, finalValue,
			i = 0;

		if ( jQuery.isFunction( value ) ) {
			return this.each( function( j ) {
				jQuery( this ).removeClass( value.call( this, j, getClass( this ) ) );
			} );
		}

		if ( !arguments.length ) {
			return this.attr( "class", "" );
		}

		if ( typeof value === "string" && value ) {
			classes = value.match( rnotwhite ) || [];

			while ( ( elem = this[ i++ ] ) ) {
				curValue = getClass( elem );

				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 &&
					( " " + curValue + " " ).replace( rclass, " " );

				if ( cur ) {
					j = 0;
					while ( ( clazz = classes[ j++ ] ) ) {

						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) > -1 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}

					// Only assign if different to avoid unneeded rendering.
					finalValue = jQuery.trim( cur );
					if ( curValue !== finalValue ) {
						elem.setAttribute( "class", finalValue );
					}
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value;

		if ( typeof stateVal === "boolean" && type === "string" ) {
			return stateVal ? this.addClass( value ) : this.removeClass( value );
		}

		if ( jQuery.isFunction( value ) ) {
			return this.each( function( i ) {
				jQuery( this ).toggleClass(
					value.call( this, i, getClass( this ), stateVal ),
					stateVal
				);
			} );
		}

		return this.each( function() {
			var className, i, self, classNames;

			if ( type === "string" ) {

				// Toggle individual class names
				i = 0;
				self = jQuery( this );
				classNames = value.match( rnotwhite ) || [];

				while ( ( className = classNames[ i++ ] ) ) {

					// Check each className given, space separated list
					if ( self.hasClass( className ) ) {
						self.removeClass( className );
					} else {
						self.addClass( className );
					}
				}

			// Toggle whole class name
			} else if ( value === undefined || type === "boolean" ) {
				className = getClass( this );
				if ( className ) {

					// Store className if set
					dataPriv.set( this, "__className__", className );
				}

				// If the element has a class name or if we're passed `false`,
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				if ( this.setAttribute ) {
					this.setAttribute( "class",
						className || value === false ?
						"" :
						dataPriv.get( this, "__className__" ) || ""
					);
				}
			}
		} );
	},

	hasClass: function( selector ) {
		var className, elem,
			i = 0;

		className = " " + selector + " ";
		while ( ( elem = this[ i++ ] ) ) {
			if ( elem.nodeType === 1 &&
				( " " + getClass( elem ) + " " ).replace( rclass, " " )
					.indexOf( className ) > -1
			) {
				return true;
			}
		}

		return false;
	}
} );




var rreturn = /\r/g,
	rspaces = /[\x20\t\r\n\f]+/g;

jQuery.fn.extend( {
	val: function( value ) {
		var hooks, ret, isFunction,
			elem = this[ 0 ];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] ||
					jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks &&
					"get" in hooks &&
					( ret = hooks.get( elem, "value" ) ) !== undefined
				) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?

					// Handle most common string cases
					ret.replace( rreturn, "" ) :

					// Handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each( function( i ) {
			var val;

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, jQuery( this ).val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";

			} else if ( typeof val === "number" ) {
				val += "";

			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map( val, function( value ) {
					return value == null ? "" : value + "";
				} );
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !( "set" in hooks ) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		} );
	}
} );

jQuery.extend( {
	valHooks: {
		option: {
			get: function( elem ) {

				var val = jQuery.find.attr( elem, "value" );
				return val != null ?
					val :

					// Support: IE10-11+
					// option.text throws exceptions (#14686, #14858)
					// Strip and collapse whitespace
					// https://html.spec.whatwg.org/#strip-and-collapse-whitespace
					jQuery.trim( jQuery.text( elem ) ).replace( rspaces, " " );
			}
		},
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// IE8-9 doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&

							// Don't return options that are disabled or in a disabled optgroup
							( support.optDisabled ?
								!option.disabled : option.getAttribute( "disabled" ) === null ) &&
							( !option.parentNode.disabled ||
								!jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var optionSet, option,
					options = elem.options,
					values = jQuery.makeArray( value ),
					i = options.length;

				while ( i-- ) {
					option = options[ i ];
					if ( option.selected =
						jQuery.inArray( jQuery.valHooks.option.get( option ), values ) > -1
					) {
						optionSet = true;
					}
				}

				// Force browsers to behave consistently when non-matching value is set
				if ( !optionSet ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	}
} );

// Radios and checkboxes getter/setter
jQuery.each( [ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery( elem ).val(), value ) > -1 );
			}
		}
	};
	if ( !support.checkOn ) {
		jQuery.valHooks[ this ].get = function( elem ) {
			return elem.getAttribute( "value" ) === null ? "on" : elem.value;
		};
	}
} );




// Return jQuery for attributes-only inclusion


var rfocusMorph = /^(?:focusinfocus|focusoutblur)$/;

jQuery.extend( jQuery.event, {

	trigger: function( event, data, elem, onlyHandlers ) {

		var i, cur, tmp, bubbleType, ontype, handle, special,
			eventPath = [ elem || document ],
			type = hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = hasOwn.call( event, "namespace" ) ? event.namespace.split( "." ) : [];

		cur = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf( "." ) > -1 ) {

			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split( "." );
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf( ":" ) < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		// Trigger bitmask: & 1 for native handlers; & 2 for jQuery (always true)
		event.isTrigger = onlyHandlers ? 2 : 3;
		event.namespace = namespaces.join( "." );
		event.rnamespace = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join( "\\.(?:.*\\.|)" ) + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === ( elem.ownerDocument || document ) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( ( cur = eventPath[ i++ ] ) && !event.isPropagationStopped() ) {

			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( dataPriv.get( cur, "events" ) || {} )[ event.type ] &&
				dataPriv.get( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && handle.apply && acceptData( cur ) ) {
				event.result = handle.apply( cur, data );
				if ( event.result === false ) {
					event.preventDefault();
				}
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( ( !special._default ||
				special._default.apply( eventPath.pop(), data ) === false ) &&
				acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && jQuery.isFunction( elem[ type ] ) && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					elem[ type ]();
					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	// Piggyback on a donor event to simulate a different one
	simulate: function( type, elem, event ) {
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{
				type: type,
				isSimulated: true

				// Previously, `originalEvent: {}` was set here, so stopPropagation call
				// would not be triggered on donor event, since in our own
				// jQuery.event.stopPropagation function we had a check for existence of
				// originalEvent.stopPropagation method, so, consequently it would be a noop.
				//
				// But now, this "simulate" function is used only for events
				// for which stopPropagation() is noop, so there is no need for that anymore.
				//
				// For the 1.x branch though, guard for "click" and "submit"
				// events is still used, but was moved to jQuery.event.stopPropagation function
				// because `originalEvent` should point to the original event for the constancy
				// with other events and for more focused logic
			}
		);

		jQuery.event.trigger( e, null, elem );

		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}

} );

jQuery.fn.extend( {

	trigger: function( type, data ) {
		return this.each( function() {
			jQuery.event.trigger( type, data, this );
		} );
	},
	triggerHandler: function( type, data ) {
		var elem = this[ 0 ];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
} );


jQuery.each( ( "blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu" ).split( " " ),
	function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};
} );

jQuery.fn.extend( {
	hover: function( fnOver, fnOut ) {
		return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
	}
} );




support.focusin = "onfocusin" in window;


// Support: Firefox
// Firefox doesn't have focus(in | out) events
// Related ticket - https://bugzilla.mozilla.org/show_bug.cgi?id=687787
//
// Support: Chrome, Safari
// focus(in | out) events fire after focus & blur events,
// which is spec violation - http://www.w3.org/TR/DOM-Level-3-Events/#events-focusevent-event-order
// Related ticket - https://code.google.com/p/chromium/issues/detail?id=449857
if ( !support.focusin ) {
	jQuery.each( { focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler on the document while someone wants focusin/focusout
		var handler = function( event ) {
			jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ) );
		};

		jQuery.event.special[ fix ] = {
			setup: function() {
				var doc = this.ownerDocument || this,
					attaches = dataPriv.access( doc, fix );

				if ( !attaches ) {
					doc.addEventListener( orig, handler, true );
				}
				dataPriv.access( doc, fix, ( attaches || 0 ) + 1 );
			},
			teardown: function() {
				var doc = this.ownerDocument || this,
					attaches = dataPriv.access( doc, fix ) - 1;

				if ( !attaches ) {
					doc.removeEventListener( orig, handler, true );
					dataPriv.remove( doc, fix );

				} else {
					dataPriv.access( doc, fix, attaches );
				}
			}
		};
	} );
}
var location = window.location;

var nonce = jQuery.now();

var rquery = ( /\?/ );



// Support: Android 2.3
// Workaround failure to string-cast null input
jQuery.parseJSON = function( data ) {
	return JSON.parse( data + "" );
};


// Cross-browser xml parsing
jQuery.parseXML = function( data ) {
	var xml;
	if ( !data || typeof data !== "string" ) {
		return null;
	}

	// Support: IE9
	try {
		xml = ( new window.DOMParser() ).parseFromString( data, "text/xml" );
	} catch ( e ) {
		xml = undefined;
	}

	if ( !xml || xml.getElementsByTagName( "parsererror" ).length ) {
		jQuery.error( "Invalid XML: " + data );
	}
	return xml;
};


var
	rhash = /#.*$/,
	rts = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)$/mg,

	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat( "*" ),

	// Anchor tag for parsing the document origin
	originAnchor = document.createElement( "a" );
	originAnchor.href = location.href;

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( rnotwhite ) || [];

		if ( jQuery.isFunction( func ) ) {

			// For each dataType in the dataTypeExpression
			while ( ( dataType = dataTypes[ i++ ] ) ) {

				// Prepend if requested
				if ( dataType[ 0 ] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					( structure[ dataType ] = structure[ dataType ] || [] ).unshift( func );

				// Otherwise append
				} else {
					( structure[ dataType ] = structure[ dataType ] || [] ).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if ( typeof dataTypeOrTransport === "string" &&
				!seekingTransport && !inspected[ dataTypeOrTransport ] ) {

				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		} );
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var key, deep,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || ( deep = {} ) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

/* Handles responses to an ajax request:
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {

	var ct, type, finalDataType, firstDataType,
		contents = s.contents,
		dataTypes = s.dataTypes;

	// Remove auto dataType and get content-type in the process
	while ( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader( "Content-Type" );
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {

		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[ 0 ] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}

		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

/* Chain conversions given the request and the original response
 * Also sets the responseXXX fields on the jqXHR instance
 */
function ajaxConvert( s, response, jqXHR, isSuccess ) {
	var conv2, current, conv, tmp, prev,
		converters = {},

		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice();

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	current = dataTypes.shift();

	// Convert to each sequential dataType
	while ( current ) {

		if ( s.responseFields[ current ] ) {
			jqXHR[ s.responseFields[ current ] ] = response;
		}

		// Apply the dataFilter if provided
		if ( !prev && isSuccess && s.dataFilter ) {
			response = s.dataFilter( response, s.dataType );
		}

		prev = current;
		current = dataTypes.shift();

		if ( current ) {

		// There's only work to do if current dataType is non-auto
			if ( current === "*" ) {

				current = prev;

			// Convert response if prev dataType is non-auto and differs from current
			} else if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split( " " );
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {

								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.unshift( tmp[ 1 ] );
								}
								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s.throws ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return {
								state: "parsererror",
								error: conv ? e : "No conversion from " + prev + " to " + current
							};
						}
					}
				}
			}
		}
	}

	return { state: "success", data: response };
}

jQuery.extend( {

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: location.href,
		type: "GET",
		isLocal: rlocalProtocol.test( location.protocol ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /\bxml\b/,
			html: /\bhtml/,
			json: /\bjson\b/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText",
			json: "responseJSON"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var transport,

			// URL without anti-cache param
			cacheURL,

			// Response headers
			responseHeadersString,
			responseHeaders,

			// timeout handle
			timeoutTimer,

			// Url cleanup var
			urlAnchor,

			// To know if global events are to be dispatched
			fireGlobals,

			// Loop variable
			i,

			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),

			// Callbacks context
			callbackContext = s.context || s,

			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context &&
				( callbackContext.nodeType || callbackContext.jquery ) ?
					jQuery( callbackContext ) :
					jQuery.event,

			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks( "once memory" ),

			// Status-dependent callbacks
			statusCode = s.statusCode || {},

			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},

			// The jqXHR state
			state = 0,

			// Default abort message
			strAbort = "canceled",

			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( ( match = rheaders.exec( responseHeadersString ) ) ) {
								responseHeaders[ match[ 1 ].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match == null ? null : match;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					var lname = name.toLowerCase();
					if ( !state ) {
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( state < 2 ) {
							for ( code in map ) {

								// Lazy-add the new callback in a way that preserves old ones
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						} else {

							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR ).complete = completeDeferred.add;
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (prefilters might expect it)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || location.href ) + "" ).replace( rhash, "" )
			.replace( rprotocol, location.protocol + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( rnotwhite ) || [ "" ];

		// A cross-domain request is in order when the origin doesn't match the current origin.
		if ( s.crossDomain == null ) {
			urlAnchor = document.createElement( "a" );

			// Support: IE8-11+
			// IE throws exception if url is malformed, e.g. http://example.com:80x/
			try {
				urlAnchor.href = s.url;

				// Support: IE8-11+
				// Anchor's host property isn't correctly set when s.url is relative
				urlAnchor.href = urlAnchor.href;
				s.crossDomain = originAnchor.protocol + "//" + originAnchor.host !==
					urlAnchor.protocol + "//" + urlAnchor.host;
			} catch ( e ) {

				// If there is an error parsing the URL, assume it is crossDomain,
				// it can be rejected by the transport if it is invalid
				s.crossDomain = true;
			}
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		// Don't fire events if jQuery.event is undefined in an AMD-usage scenario (#15118)
		fireGlobals = jQuery.event && s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger( "ajaxStart" );
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		cacheURL = s.url;

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				cacheURL = ( s.url += ( rquery.test( cacheURL ) ? "&" : "?" ) + s.data );

				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add anti-cache in url if needed
			if ( s.cache === false ) {
				s.url = rts.test( cacheURL ) ?

					// If there is already a '_' parameter, set its value
					cacheURL.replace( rts, "$1_=" + nonce++ ) :

					// Otherwise add one to the end
					cacheURL + ( rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + nonce++;
			}
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[ 0 ] ] ?
				s.accepts[ s.dataTypes[ 0 ] ] +
					( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend &&
			( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {

			// Abort if not done already and return
			return jqXHR.abort();
		}

		// Aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}

			// If request was aborted inside ajaxSend, stop there
			if ( state === 2 ) {
				return jqXHR;
			}

			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = window.setTimeout( function() {
					jqXHR.abort( "timeout" );
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch ( e ) {

				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );

				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				window.clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Determine if successful
			isSuccess = status >= 200 && status < 300 || status === 304;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// Convert no matter what (that way responseXXX fields are always set)
			response = ajaxConvert( s, response, jqXHR, isSuccess );

			// If successful, handle type chaining
			if ( isSuccess ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader( "Last-Modified" );
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader( "etag" );
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 || s.type === "HEAD" ) {
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					statusText = response.state;
					success = response.data;
					error = response.error;
					isSuccess = !error;
				}
			} else {

				// Extract error from statusText and normalize for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );

				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger( "ajaxStop" );
				}
			}
		}

		return jqXHR;
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	}
} );

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {

		// Shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		// The url can be an options object (which then must have .url)
		return jQuery.ajax( jQuery.extend( {
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		}, jQuery.isPlainObject( url ) && url ) );
	};
} );


jQuery._evalUrl = function( url ) {
	return jQuery.ajax( {
		url: url,

		// Make this explicit, since user can override this through ajaxSetup (#11264)
		type: "GET",
		dataType: "script",
		async: false,
		global: false,
		"throws": true
	} );
};


jQuery.fn.extend( {
	wrapAll: function( html ) {
		var wrap;

		if ( jQuery.isFunction( html ) ) {
			return this.each( function( i ) {
				jQuery( this ).wrapAll( html.call( this, i ) );
			} );
		}

		if ( this[ 0 ] ) {

			// The elements to wrap the target around
			wrap = jQuery( html, this[ 0 ].ownerDocument ).eq( 0 ).clone( true );

			if ( this[ 0 ].parentNode ) {
				wrap.insertBefore( this[ 0 ] );
			}

			wrap.map( function() {
				var elem = this;

				while ( elem.firstElementChild ) {
					elem = elem.firstElementChild;
				}

				return elem;
			} ).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each( function( i ) {
				jQuery( this ).wrapInner( html.call( this, i ) );
			} );
		}

		return this.each( function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		} );
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each( function( i ) {
			jQuery( this ).wrapAll( isFunction ? html.call( this, i ) : html );
		} );
	},

	unwrap: function() {
		return this.parent().each( function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		} ).end();
	}
} );


jQuery.expr.filters.hidden = function( elem ) {
	return !jQuery.expr.filters.visible( elem );
};
jQuery.expr.filters.visible = function( elem ) {

	// Support: Opera <= 12.12
	// Opera reports offsetWidths and offsetHeights less than zero on some elements
	// Use OR instead of AND as the element is not visible if either is true
	// See tickets #10406 and #13132
	return elem.offsetWidth > 0 || elem.offsetHeight > 0 || elem.getClientRects().length > 0;
};




var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {

		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {

				// Treat each array item as a scalar.
				add( prefix, v );

			} else {

				// Item is non-scalar (array or object), encode its numeric index.
				buildParams(
					prefix + "[" + ( typeof v === "object" && v != null ? i : "" ) + "]",
					v,
					traditional,
					add
				);
			}
		} );

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {

		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {

		// Serialize scalar item.
		add( prefix, obj );
	}
}

// Serialize an array of form elements or a set of
// key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {

			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {

		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		} );

	} else {

		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

jQuery.fn.extend( {
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map( function() {

			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		} )
		.filter( function() {
			var type = this.type;

			// Use .is( ":disabled" ) so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !rcheckableType.test( type ) );
		} )
		.map( function( i, elem ) {
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val ) {
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					} ) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		} ).get();
	}
} );


jQuery.ajaxSettings.xhr = function() {
	try {
		return new window.XMLHttpRequest();
	} catch ( e ) {}
};

var xhrSuccessStatus = {

		// File protocol always yields status code 0, assume 200
		0: 200,

		// Support: IE9
		// #1450: sometimes IE returns 1223 when it should be 204
		1223: 204
	},
	xhrSupported = jQuery.ajaxSettings.xhr();

support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
support.ajax = xhrSupported = !!xhrSupported;

jQuery.ajaxTransport( function( options ) {
	var callback, errorCallback;

	// Cross domain only allowed if supported through XMLHttpRequest
	if ( support.cors || xhrSupported && !options.crossDomain ) {
		return {
			send: function( headers, complete ) {
				var i,
					xhr = options.xhr();

				xhr.open(
					options.type,
					options.url,
					options.async,
					options.username,
					options.password
				);

				// Apply custom fields if provided
				if ( options.xhrFields ) {
					for ( i in options.xhrFields ) {
						xhr[ i ] = options.xhrFields[ i ];
					}
				}

				// Override mime type if needed
				if ( options.mimeType && xhr.overrideMimeType ) {
					xhr.overrideMimeType( options.mimeType );
				}

				// X-Requested-With header
				// For cross-domain requests, seeing as conditions for a preflight are
				// akin to a jigsaw puzzle, we simply never set it to be sure.
				// (it can always be set on a per-request basis or even using ajaxSetup)
				// For same-domain requests, won't change header if already provided.
				if ( !options.crossDomain && !headers[ "X-Requested-With" ] ) {
					headers[ "X-Requested-With" ] = "XMLHttpRequest";
				}

				// Set headers
				for ( i in headers ) {
					xhr.setRequestHeader( i, headers[ i ] );
				}

				// Callback
				callback = function( type ) {
					return function() {
						if ( callback ) {
							callback = errorCallback = xhr.onload =
								xhr.onerror = xhr.onabort = xhr.onreadystatechange = null;

							if ( type === "abort" ) {
								xhr.abort();
							} else if ( type === "error" ) {

								// Support: IE9
								// On a manual native abort, IE9 throws
								// errors on any property access that is not readyState
								if ( typeof xhr.status !== "number" ) {
									complete( 0, "error" );
								} else {
									complete(

										// File: protocol always yields status 0; see #8605, #14207
										xhr.status,
										xhr.statusText
									);
								}
							} else {
								complete(
									xhrSuccessStatus[ xhr.status ] || xhr.status,
									xhr.statusText,

									// Support: IE9 only
									// IE9 has no XHR2 but throws on binary (trac-11426)
									// For XHR2 non-text, let the caller handle it (gh-2498)
									( xhr.responseType || "text" ) !== "text"  ||
									typeof xhr.responseText !== "string" ?
										{ binary: xhr.response } :
										{ text: xhr.responseText },
									xhr.getAllResponseHeaders()
								);
							}
						}
					};
				};

				// Listen to events
				xhr.onload = callback();
				errorCallback = xhr.onerror = callback( "error" );

				// Support: IE9
				// Use onreadystatechange to replace onabort
				// to handle uncaught aborts
				if ( xhr.onabort !== undefined ) {
					xhr.onabort = errorCallback;
				} else {
					xhr.onreadystatechange = function() {

						// Check readyState before timeout as it changes
						if ( xhr.readyState === 4 ) {

							// Allow onerror to be called first,
							// but that will not handle a native abort
							// Also, save errorCallback to a variable
							// as xhr.onerror cannot be accessed
							window.setTimeout( function() {
								if ( callback ) {
									errorCallback();
								}
							} );
						}
					};
				}

				// Create the abort callback
				callback = callback( "abort" );

				try {

					// Do send the request (this may raise an exception)
					xhr.send( options.hasContent && options.data || null );
				} catch ( e ) {

					// #14683: Only rethrow if this hasn't been notified as an error yet
					if ( callback ) {
						throw e;
					}
				}
			},

			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




// Install script dataType
jQuery.ajaxSetup( {
	accepts: {
		script: "text/javascript, application/javascript, " +
			"application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /\b(?:java|ecma)script\b/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
} );

// Handle cache's special case and crossDomain
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
	}
} );

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function( s ) {

	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {
		var script, callback;
		return {
			send: function( _, complete ) {
				script = jQuery( "<script>" ).prop( {
					charset: s.scriptCharset,
					src: s.url
				} ).on(
					"load error",
					callback = function( evt ) {
						script.remove();
						callback = null;
						if ( evt ) {
							complete( evt.type === "error" ? 404 : 200, evt.type );
						}
					}
				);

				// Use native DOM manipulation to avoid our domManip AJAX trickery
				document.head.appendChild( script[ 0 ] );
			},
			abort: function() {
				if ( callback ) {
					callback();
				}
			}
		};
	}
} );




var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup( {
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
} );

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" &&
				( s.contentType || "" )
					.indexOf( "application/x-www-form-urlencoded" ) === 0 &&
				rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters[ "script json" ] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// Force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always( function() {

			// If previous value didn't exist - remove it
			if ( overwritten === undefined ) {
				jQuery( window ).removeProp( callbackName );

			// Otherwise restore preexisting value
			} else {
				window[ callbackName ] = overwritten;
			}

			// Save back as free
			if ( s[ callbackName ] ) {

				// Make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// Save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		} );

		// Delegate to script
		return "script";
	}
} );




// Argument "data" should be string of html
// context (optional): If specified, the fragment will be created in this context,
// defaults to document
// keepScripts (optional): If true, will include scripts passed in the html string
jQuery.parseHTML = function( data, context, keepScripts ) {
	if ( !data || typeof data !== "string" ) {
		return null;
	}
	if ( typeof context === "boolean" ) {
		keepScripts = context;
		context = false;
	}
	context = context || document;

	var parsed = rsingleTag.exec( data ),
		scripts = !keepScripts && [];

	// Single tag
	if ( parsed ) {
		return [ context.createElement( parsed[ 1 ] ) ];
	}

	parsed = buildFragment( [ data ], context, scripts );

	if ( scripts && scripts.length ) {
		jQuery( scripts ).remove();
	}

	return jQuery.merge( [], parsed.childNodes );
};


// Keep a copy of the old load method
var _load = jQuery.fn.load;

/**
 * Load a url into a page
 */
jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	var selector, type, response,
		self = this,
		off = url.indexOf( " " );

	if ( off > -1 ) {
		selector = jQuery.trim( url.slice( off ) );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax( {
			url: url,

			// If "type" variable is undefined, then "GET" method will be used.
			// Make value of this field explicit since
			// user can override it through ajaxSetup method
			type: type || "GET",
			dataType: "html",
			data: params
		} ).done( function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery( "<div>" ).append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		// If the request succeeds, this function gets "data", "status", "jqXHR"
		// but they are ignored because response was set above.
		// If it fails, this function gets "jqXHR", "status", "error"
		} ).always( callback && function( jqXHR, status ) {
			self.each( function() {
				callback.apply( this, response || [ jqXHR.responseText, status, jqXHR ] );
			} );
		} );
	}

	return this;
};




// Attach a bunch of functions for handling common AJAX events
jQuery.each( [
	"ajaxStart",
	"ajaxStop",
	"ajaxComplete",
	"ajaxError",
	"ajaxSuccess",
	"ajaxSend"
], function( i, type ) {
	jQuery.fn[ type ] = function( fn ) {
		return this.on( type, fn );
	};
} );




jQuery.expr.filters.animated = function( elem ) {
	return jQuery.grep( jQuery.timers, function( fn ) {
		return elem === fn.elem;
	} ).length;
};




/**
 * Gets a window from an element
 */
function getWindow( elem ) {
	return jQuery.isWindow( elem ) ? elem : elem.nodeType === 9 && elem.defaultView;
}

jQuery.offset = {
	setOffset: function( elem, options, i ) {
		var curPosition, curLeft, curCSSTop, curTop, curOffset, curCSSLeft, calculatePosition,
			position = jQuery.css( elem, "position" ),
			curElem = jQuery( elem ),
			props = {};

		// Set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		curOffset = curElem.offset();
		curCSSTop = jQuery.css( elem, "top" );
		curCSSLeft = jQuery.css( elem, "left" );
		calculatePosition = ( position === "absolute" || position === "fixed" ) &&
			( curCSSTop + curCSSLeft ).indexOf( "auto" ) > -1;

		// Need to be able to calculate position if either
		// top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;

		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {

			// Use jQuery.extend here to allow modification of coordinates argument (gh-1848)
			options = options.call( elem, i, jQuery.extend( {}, curOffset ) );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );

		} else {
			curElem.css( props );
		}
	}
};

jQuery.fn.extend( {
	offset: function( options ) {
		if ( arguments.length ) {
			return options === undefined ?
				this :
				this.each( function( i ) {
					jQuery.offset.setOffset( this, options, i );
				} );
		}

		var docElem, win,
			elem = this[ 0 ],
			box = { top: 0, left: 0 },
			doc = elem && elem.ownerDocument;

		if ( !doc ) {
			return;
		}

		docElem = doc.documentElement;

		// Make sure it's not a disconnected DOM node
		if ( !jQuery.contains( docElem, elem ) ) {
			return box;
		}

		box = elem.getBoundingClientRect();
		win = getWindow( doc );
		return {
			top: box.top + win.pageYOffset - docElem.clientTop,
			left: box.left + win.pageXOffset - docElem.clientLeft
		};
	},

	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset,
			elem = this[ 0 ],
			parentOffset = { top: 0, left: 0 };

		// Fixed elements are offset from window (parentOffset = {top:0, left: 0},
		// because it is its only offset parent
		if ( jQuery.css( elem, "position" ) === "fixed" ) {

			// Assume getBoundingClientRect is there when computed position is fixed
			offset = elem.getBoundingClientRect();

		} else {

			// Get *real* offsetParent
			offsetParent = this.offsetParent();

			// Get correct offsets
			offset = this.offset();
			if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
				parentOffset = offsetParent.offset();
			}

			// Add offsetParent borders
			parentOffset.top += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
			parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
		}

		// Subtract parent offsets and element margins
		return {
			top: offset.top - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true )
		};
	},

	// This method will return documentElement in the following cases:
	// 1) For the element inside the iframe without offsetParent, this method will return
	//    documentElement of the parent window
	// 2) For the hidden or detached element
	// 3) For body or html element, i.e. in case of the html node - it will return itself
	//
	// but those exceptions were never presented as a real life use-cases
	// and might be considered as more preferable results.
	//
	// This logic, however, is not guaranteed and can change at any point in the future
	offsetParent: function() {
		return this.map( function() {
			var offsetParent = this.offsetParent;

			while ( offsetParent && jQuery.css( offsetParent, "position" ) === "static" ) {
				offsetParent = offsetParent.offsetParent;
			}

			return offsetParent || documentElement;
		} );
	}
} );

// Create scrollLeft and scrollTop methods
jQuery.each( { scrollLeft: "pageXOffset", scrollTop: "pageYOffset" }, function( method, prop ) {
	var top = "pageYOffset" === prop;

	jQuery.fn[ method ] = function( val ) {
		return access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? win[ prop ] : elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : win.pageXOffset,
					top ? val : win.pageYOffset
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length );
	};
} );

// Support: Safari<7-8+, Chrome<37-44+
// Add the top/left cssHooks using jQuery.fn.position
// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
// Blink bug: https://code.google.com/p/chromium/issues/detail?id=229280
// getComputedStyle returns percent when specified for top/left/bottom/right;
// rather than make the css module depend on the offset module, just check for it here
jQuery.each( [ "top", "left" ], function( i, prop ) {
	jQuery.cssHooks[ prop ] = addGetHookIf( support.pixelPosition,
		function( elem, computed ) {
			if ( computed ) {
				computed = curCSS( elem, prop );

				// If curCSS returns percentage, fallback to offset
				return rnumnonpx.test( computed ) ?
					jQuery( elem ).position()[ prop ] + "px" :
					computed;
			}
		}
	);
} );


// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name },
		function( defaultExtra, funcName ) {

		// Margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {

					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height],
					// whichever is greatest
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?

					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	} );
} );


jQuery.fn.extend( {

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {

		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ?
			this.off( selector, "**" ) :
			this.off( types, selector || "**", fn );
	},
	size: function() {
		return this.length;
	}
} );

jQuery.fn.andSelf = jQuery.fn.addBack;




// Register as a named AMD module, since jQuery can be concatenated with other
// files that may use define, but not via a proper concatenation script that
// understands anonymous AMD modules. A named AMD is safest and most robust
// way to register. Lowercase jquery is used because AMD module names are
// derived from file names, and jQuery is normally delivered in a lowercase
// file name. Do this after creating the global so that if an AMD module wants
// to call noConflict to hide this version of jQuery, it will work.

// Note that for maximum portability, libraries that are not jQuery should
// declare themselves as anonymous modules, and avoid setting a global if an
// AMD loader is present. jQuery is a special case. For more information, see
// https://github.com/jrburke/requirejs/wiki/Updating-existing-libraries#wiki-anon

if ( typeof define === "function" && define.amd ) {
	define( "jquery", [], function() {
		return jQuery;
	} );
}



var

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$;

jQuery.noConflict = function( deep ) {
	if ( window.$ === jQuery ) {
		window.$ = _$;
	}

	if ( deep && window.jQuery === jQuery ) {
		window.jQuery = _jQuery;
	}

	return jQuery;
};

// Expose jQuery and $ identifiers, even in AMD
// (#7102#comment:10, https://github.com/jquery/jquery/pull/557)
// and CommonJS for browser emulators (#13566)
if ( !noGlobal ) {
	window.jQuery = window.$ = jQuery;
}

return jQuery;
}));

define('calculator/lib/Actions',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var _class = function () {
        function _class(actions) {
            _classCallCheck(this, _class);

            this.actions = actions;
        }

        _createClass(_class, [{
            key: "getAction",
            value: function getAction(actionName) {
                return this.actions[actionName];
            }
        }]);

        return _class;
    }();

    exports.default = _class;
});
//# sourceMappingURL=Actions.js.map
;
define('calculator/lib/Calculations',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var _class = function () {
        function _class(calculations) {
            _classCallCheck(this, _class);

            this.calculations = calculations;
        }

        _createClass(_class, [{
            key: "getCalculation",
            value: function getCalculation(calculationName) {
                return this.calculations[calculationName];
            }
        }]);

        return _class;
    }();

    exports.default = _class;
});
//# sourceMappingURL=Calculations.js.map
;
define('calculator/lib/actions/MemoryClear',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (memoryManager) {
        memoryManager.clear();
    };
});
//# sourceMappingURL=MemoryClear.js.map
;
define('calculator/lib/actions/MemoryMinus',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (tokenManager, memoryManager) {
        tokenManager.memoryClick();
        memoryManager.minus(null, tokenManager.answerStr);
    };
});
//# sourceMappingURL=MemoryMinus.js.map
;
define('calculator/lib/actions/MemoryPlus',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (tokenManager, memoryManager) {
        tokenManager.memoryClick();
        memoryManager.plus(null, tokenManager.answerStr);
    };
});
//# sourceMappingURL=MemoryPlus.js.map
;
define('calculator/lib/actions/MemoryRestore',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (tokenManager, memoryManager) {
        tokenManager.push(memoryManager.getLast().value, { replace: true });
    };
});
//# sourceMappingURL=MemoryRestore.js.map
;
define('calculator/lib/actions/MemorySave',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (tokenManager, memoryManager) {
        tokenManager.memoryClick();
        memoryManager.save(tokenManager.answerStr);
    };
});
//# sourceMappingURL=MemorySave.js.map
;
define('calculator/lib/actions/ToggleClass',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (panel, className) {
        panel.$el.toggleClass(className);
    };
});
//# sourceMappingURL=ToggleClass.js.map
;
define('calculator/config/actions',['exports', '../lib/actions/MemoryClear', '../lib/actions/MemoryMinus', '../lib/actions/MemoryPlus', '../lib/actions/MemoryRestore', '../lib/actions/MemorySave', '../lib/actions/ToggleClass'], function (exports, _MemoryClear, _MemoryMinus, _MemoryPlus, _MemoryRestore, _MemorySave, _ToggleClass) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _MemoryClear2 = _interopRequireDefault(_MemoryClear);

    var _MemoryMinus2 = _interopRequireDefault(_MemoryMinus);

    var _MemoryPlus2 = _interopRequireDefault(_MemoryPlus);

    var _MemoryRestore2 = _interopRequireDefault(_MemoryRestore);

    var _MemorySave2 = _interopRequireDefault(_MemorySave);

    var _ToggleClass2 = _interopRequireDefault(_ToggleClass);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = {
        'MemoryClear': _MemoryClear2.default,
        'MemoryMinus': _MemoryMinus2.default,
        'MemoryPlus': _MemoryPlus2.default,
        'MemoryRestore': _MemoryRestore2.default,
        'MemorySave': _MemorySave2.default,
        'ToggleClass': _ToggleClass2.default
    };
});
//# sourceMappingURL=actions.js.map
;
define('calculator/constant/TokenManagerStates',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    var TokenManagerStates = {};

    Object.defineProperties(TokenManagerStates, {
        NORMAL: { value: 'Normal', enumerable: true },
        EVALUATED: { value: 'Evaluated', enumerable: true },
        INVALID: { value: 'Invalid', enumerable: true }
    });

    exports.default = TokenManagerStates;
});
//# sourceMappingURL=TokenManagerStates.js.map
;
define('calculator/lib/calculations/AddNumberToken',['exports', 'calculator/constant/TokenManagerStates'], function (exports, _TokenManagerStates) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (tokenManager, button) {

        var mathSymbol = button.mathSymbol;
        var removeZero = true;

        if (tokenManager.state === _TokenManagerStates2.default.INVALID) {
            tokenManager.clear();
            return;
        }

        if (tokenManager.answerStr === '0' && button.mathSymbol === '0') {
            return;
        }
        if (tokenManager.answerStr.indexOf('.') !== -1 && button.mathSymbol === '.') {
            return;
        }
        if (tokenManager.answerStr === '0' && button.mathSymbol === '.') {
            removeZero = false;
        }

        if (tokenManager.state === _TokenManagerStates2.default.EVALUATED && button.mathSymbol === '.') {
            tokenManager.push('0');
        }

        tokenManager.push(mathSymbol, {
            replace: tokenManager.answerStr === '0' && removeZero || tokenManager.state === _TokenManagerStates2.default.EVALUATED
        });
    };
});
//# sourceMappingURL=AddNumberToken.js.map
;
define('calculator/constant/TokenManagerEvents',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    var TokenManagerEvents = {};

    Object.defineProperties(TokenManagerEvents, {
        CHANGE: { value: 'change' },
        EVALUATION: { value: 'evaluation' },
        CUSTOM: { value: 'custom' }
    });

    exports.default = TokenManagerEvents;
});
//# sourceMappingURL=TokenManagerEvents.js.map
;
define('calculator/lib/calculations/AddArithmeticToken',['exports', 'calculator/constant/TokenManagerEvents'], function (exports, _TokenManagerEvents) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerEvents2 = _interopRequireDefault(_TokenManagerEvents);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (tokenManager, button) {
        tokenManager.push(button.mathSymbol, {
            replace: tokenManager.isLastToken(['+', '-', '&times;', '&divide;'])
        });

        tokenManager.trigger(_TokenManagerEvents2.default.EVALUATION);
    };
});
//# sourceMappingURL=AddArithmeticToken.js.map
;
define('calculator/lib/calculations/Evaluate',['exports', 'calculator/constant/TokenManagerStates'], function (exports, _TokenManagerStates) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (tokenManager, button) {
        if (tokenManager.state === _TokenManagerStates2.default.INVALID) {
            tokenManager.clear();
            return;
        }

        tokenManager.evaluate();
    };
});
//# sourceMappingURL=Evaluate.js.map
;
define('calculator/lib/calculations/ClearTokens',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (tokenManager, button) {
        tokenManager.clear();
    };
});
//# sourceMappingURL=ClearTokens.js.map
;
define('calculator/lib/calculations/ClearLastTokens',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (tokenManager, button) {
        tokenManager.clear(true);
    };
});
//# sourceMappingURL=ClearLastTokens.js.map
;
/**
 * math.js
 * https://github.com/josdejong/mathjs
 *
 * Math.js is an extensive math library for JavaScript and Node.js,
 * It features real and complex numbers, units, matrices, a large set of
 * mathematical functions, and a flexible expression parser.
 *
 * @version 3.2.1
 * @date    2016-04-26
 *
 * @license
 * Copyright (C) 2013-2016 Jos de Jong <wjosdejong@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy
 * of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */
!function(e,t){"object"==typeof exports&&"object"==typeof module?module.exports=t():"function"==typeof define&&define.amd?define('mathjs',[],t):"object"==typeof exports?exports.math=t():e.math=t()}(this,function(){return function(e){function t(n){if(r[n])return r[n].exports;var i=r[n]={exports:{},id:n,loaded:!1};return e[n].call(i.exports,i,i.exports,t),i.loaded=!0,i.exports}var r={};return t.m=e,t.c=r,t.p="",t(0)}([function(e,t,r){function n(e){var t=i.create(e);return t.create=n,t["import"](r(13)),t}var i=r(1);e.exports=n()},function(e,t,r){e.exports=r(2)},function(e,t,r){var n=r(3).isFactory,i=(r(3).deepExtend,r(4)),a=r(8),o=r(10),s=r(12);t.create=function(e){function t(e){if(!n(e))throw new Error("Factory object with properties `type`, `name`, and `factory` expected");var i,a=r.indexOf(e);return-1===a?(i=e.math===!0?e.factory(c.type,f,t,c.typed,c):e.factory(c.type,f,t,c.typed),r.push(e),u.push(i)):i=u[a],i}if("function"!=typeof Object.create)throw new Error("ES5 not supported by this JavaScript engine. Please load the es5-shim and es5-sham library for compatibility.");var r=[],u=[],c=a.mixin({});c.type={},c.expression={transform:Object.create(c)},c.typed=i.create(c.type);var f={epsilon:1e-12,matrix:"Matrix",number:"number",precision:64,predictable:!1};return c["import"]=t(o),c.config=t(s),e&&c.config(e),c}},function(e,t){"use strict";t.clone=function r(e){var t=typeof e;if("number"===t||"string"===t||"boolean"===t||null===e||void 0===e)return e;if("function"==typeof e.clone)return e.clone();if(Array.isArray(e))return e.map(function(e){return r(e)});if(e instanceof Number)return new Number(e.valueOf());if(e instanceof String)return new String(e.valueOf());if(e instanceof Boolean)return new Boolean(e.valueOf());if(e instanceof Date)return new Date(e.valueOf());if(e&&e.isBigNumber===!0)return e;if(e instanceof RegExp)throw new TypeError("Cannot clone "+e);var n={};for(var i in e)e.hasOwnProperty(i)&&(n[i]=r(e[i]));return n},t.extend=function(e,t){for(var r in t)t.hasOwnProperty(r)&&(e[r]=t[r]);return e},t.deepExtend=function n(e,t){if(Array.isArray(t))throw new TypeError("Arrays are not supported by deepExtend");for(var r in t)if(t.hasOwnProperty(r))if(t[r]&&t[r].constructor===Object)void 0===e[r]&&(e[r]={}),e[r].constructor===Object?n(e[r],t[r]):e[r]=t[r];else{if(Array.isArray(t[r]))throw new TypeError("Arrays are not supported by deepExtend");e[r]=t[r]}return e},t.deepEqual=function(e,r){var n,i,a;if(Array.isArray(e)){if(!Array.isArray(r))return!1;if(e.length!=r.length)return!1;for(i=0,a=e.length;a>i;i++)if(!t.deepEqual(e[i],r[i]))return!1;return!0}if(e instanceof Object){if(Array.isArray(r)||!(r instanceof Object))return!1;for(n in e)if(!t.deepEqual(e[n],r[n]))return!1;for(n in r)if(!t.deepEqual(e[n],r[n]))return!1;return!0}return typeof e==typeof r&&e==r},t.canDefineProperty=function(){try{if(Object.defineProperty)return Object.defineProperty({},"x",{get:function(){}}),!0}catch(e){}return!1},t.lazy=function(e,r,n){if(t.canDefineProperty()){var i,a=!0;Object.defineProperty(e,r,{get:function(){return a&&(i=n(),a=!1),i},set:function(e){i=e,a=!1},configurable:!0,enumerable:!0})}else e[r]=n()},t.traverse=function(e,t){var r=e;if(t)for(var n=t.split("."),i=0;i<n.length;i++){var a=n[i];a in r||(r[a]={}),r=r[a]}return r},t.isFactory=function(e){return e&&"function"==typeof e.factory}},function(e,t,r){var n=r(5),i=r(6).digits,a=function(){return a=n.create,n};t.create=function(e){var t=a();return t.types=[{name:"number",test:function(e){return"number"==typeof e}},{name:"Complex",test:function(e){return e&&e.isComplex}},{name:"BigNumber",test:function(e){return e&&e.isBigNumber}},{name:"Fraction",test:function(e){return e&&e.isFraction}},{name:"Unit",test:function(e){return e&&e.isUnit}},{name:"string",test:function(e){return"string"==typeof e}},{name:"Array",test:Array.isArray},{name:"Matrix",test:function(e){return e&&e.isMatrix}},{name:"DenseMatrix",test:function(e){return e&&e.isDenseMatrix}},{name:"SparseMatrix",test:function(e){return e&&e.isSparseMatrix}},{name:"ImmutableDenseMatrix",test:function(e){return e&&e.isImmutableDenseMatrix}},{name:"Range",test:function(e){return e&&e.isRange}},{name:"Index",test:function(e){return e&&e.isIndex}},{name:"boolean",test:function(e){return"boolean"==typeof e}},{name:"ResultSet",test:function(e){return e&&e.isResultSet}},{name:"Help",test:function(e){return e&&e.isHelp}},{name:"function",test:function(e){return"function"==typeof e}},{name:"Date",test:function(e){return e instanceof Date}},{name:"RegExp",test:function(e){return e instanceof RegExp}},{name:"Object",test:function(e){return"object"==typeof e}},{name:"null",test:function(e){return null===e}},{name:"undefined",test:function(e){return void 0===e}}],t.conversions=[{from:"number",to:"BigNumber",convert:function(t){if(i(t)>15)throw new TypeError("Cannot implicitly convert a number with >15 significant digits to BigNumber (value: "+t+"). Use function bignumber(x) to convert to BigNumber.");return new e.BigNumber(t)}},{from:"number",to:"Complex",convert:function(t){return new e.Complex(t,0)}},{from:"number",to:"string",convert:function(e){return e+""}},{from:"BigNumber",to:"Complex",convert:function(t){return new e.Complex(t.toNumber(),0)}},{from:"Fraction",to:"Complex",convert:function(t){return new e.Complex(t.valueOf(),0)}},{from:"number",to:"Fraction",convert:function(t){if(i(t)>15)throw new TypeError("Cannot implicitly convert a number with >15 significant digits to Fraction (value: "+t+"). Use function fraction(x) to convert to Fraction.");return new e.Fraction(t)}},{from:"string",to:"number",convert:function(e){var t=Number(e);if(isNaN(t))throw new Error('Cannot convert "'+e+'" to a number');return t}},{from:"boolean",to:"number",convert:function(e){return+e}},{from:"boolean",to:"BigNumber",convert:function(t){return new e.BigNumber(+t)}},{from:"boolean",to:"Fraction",convert:function(t){return new e.Fraction(+t)}},{from:"boolean",to:"string",convert:function(e){return+e}},{from:"null",to:"number",convert:function(){return 0}},{from:"null",to:"string",convert:function(){return"null"}},{from:"null",to:"BigNumber",convert:function(){return new e.BigNumber(0)}},{from:"null",to:"Fraction",convert:function(){return new e.Fraction(0)}},{from:"Array",to:"Matrix",convert:function(t){return new e.DenseMatrix(t)}},{from:"Matrix",to:"Array",convert:function(e){return e.valueOf()}}],t}},function(e,t,r){var n,i,a;!function(r,o){i=[],n=o,a="function"==typeof n?n.apply(t,i):n,!(void 0!==a&&(e.exports=a))}(this,function(){function e(){function t(e){for(var t,r=0;r<N.types.length;r++){var n=N.types[r];if(n.name===e){t=n.test;break}}if(!t){var i;for(r=0;r<N.types.length;r++)if(n=N.types[r],n.name.toLowerCase()==e.toLowerCase()){i=n.name;break}throw new Error('Unknown type "'+e+'"'+(i?'. Did you mean "'+i+'"?':""))}return t}function r(e){for(var t="",r=0;r<e.length;r++){var n=e[r];if(n.signatures&&""!=n.name)if(""==t)t=n.name;else if(t!=n.name){var i=new Error("Function names do not match (expected: "+t+", actual: "+n.name+")");throw i.data={actual:n.name,expected:t},i}}return t}function n(e,t,r,n,i){var a,o=m(n),s=i?i.split(","):null,u=e||"unnamed",c=s&&d(s,"any"),f={fn:e,index:r,actual:n,expected:s};a=s?t>r&&!c?"Unexpected type of argument in function "+u+" (expected: "+s.join(" or ")+", actual: "+o+", index: "+r+")":"Too few arguments in function "+u+" (expected: "+s.join(" or ")+", index: "+r+")":"Too many arguments in function "+u+" (expected: "+r+", actual: "+t+")";var l=new TypeError(a);return l.data=f,l}function i(e){this.name=e||"refs",this.categories={}}function a(e,t){if("string"==typeof e){var r=e.trim(),n="..."===r.substr(0,3);if(n&&(r=r.substr(3)),""===r)this.types=["any"];else{this.types=r.split("|");for(var i=0;i<this.types.length;i++)this.types[i]=this.types[i].trim()}}else{if(!Array.isArray(e)){if(e instanceof a)return e.clone();throw new Error("String or Array expected")}this.types=e}this.conversions=[],this.varArgs=n||t||!1,this.anyType=-1!==this.types.indexOf("any")}function o(e,t){var r;if("string"==typeof e)r=""!==e?e.split(","):[];else{if(!Array.isArray(e))throw new Error("string or Array expected");r=e}this.params=new Array(r.length);for(var n=0;n<r.length;n++){var i=new a(r[n]);if(this.params[n]=i,n===r.length-1)this.varArgs=i.varArgs;else if(i.varArgs)throw new SyntaxError('Unexpected variable arguments operator "..."')}this.fn=t}function s(e,t,r){this.path=e||[],this.param=e[e.length-1]||null,this.signature=t||null,this.childs=r||[]}function u(e){var t,r,n={},i=[];for(var a in e)if(e.hasOwnProperty(a)){var s=e[a];if(t=new o(a,s),t.ignore())continue;var u=t.expand();for(r=0;r<u.length;r++){var c=u[r],f=c.toString(),l=n[f];if(l){var p=o.compare(c,l);if(0>p)n[f]=c;else if(0===p)throw new Error('Signature "'+f+'" is defined twice')}else n[f]=c}}for(f in n)n.hasOwnProperty(f)&&i.push(n[f]);for(i.sort(function(e,t){return o.compare(e,t)}),r=0;r<i.length;r++)if(t=i[r],t.varArgs)for(var h=t.params.length-1,m=t.params[h],g=0;g<m.types.length;){if(m.conversions[g])for(var v=m.types[g],y=0;y<i.length;y++){var x=i[y],b=x.params[h];if(x!==t&&b&&d(b.types,v)&&!b.conversions[h]){m.types.splice(g,1),m.conversions.splice(g,1),g--;break}}g++}return i}function c(e){for(var t={},r=0;r<e.length;r++){var n=e[r];if(n.fn&&!n.hasConversions()){var i=n.params.join(",");t[i]=n.fn}}return t}function f(e,t){var r,n,i,o=t.length,u=[];for(r=0;r<e.length;r++)n=e[r],n.params.length!==o||i||(i=n),void 0!=n.params[o]&&u.push(n);u.sort(function(e,t){return a.compare(e.params[o],t.params[o])});var c=[];for(r=0;r<u.length;r++){n=u[r];var l=n.params[o],p=c.filter(function(e){return e.param.overlapping(l)})[0];if(p){if(p.param.varArgs)throw new Error('Conflicting types "'+p.param+'" and "'+l+'"');p.signatures.push(n)}else c.push({param:l,signatures:[n]})}var h=new Array(c.length);for(r=0;r<c.length;r++){var m=c[r];h[r]=f(m.signatures,t.concat(m.param))}return new s(t,i,h)}function l(e){for(var t=[],r=0;e>r;r++)t[r]="arg"+r;return t}function p(e,t){var r=new i,a=u(t);if(0==a.length)throw new Error("No signatures provided");var o=f(a,[]),s=[],p=e||"",m=l(h(a));s.push("function "+p+"("+m.join(", ")+") {"),s.push('  "use strict";'),s.push("  var name = '"+p+"';"),s.push(o.toCode(r,"  ")),s.push("}");var d=[r.toCode(),"return "+s.join("\n")].join("\n"),g=new Function(r.name,"createError",d),v=g(r,n);return v.signatures=c(a),v}function h(e){for(var t=0,r=0;r<e.length;r++){var n=e[r].params.length;n>t&&(t=n)}return t}function m(e){for(var t,r=0;r<N.types.length;r++){var n=N.types[r];if("Object"===n.name)t=n;else if(n.test(e))return n.name}return t&&t.test(e)?t.name:"unknown"}function d(e,t){return-1!==e.indexOf(t)}function g(e,t){if(!e.signatures)throw new TypeError("Function is no typed-function");var r;if("string"==typeof t){r=t.split(",");for(var n=0;n<r.length;n++)r[n]=r[n].trim()}else{if(!Array.isArray(t))throw new TypeError("String array or a comma separated string expected");r=t}var i=r.join(","),a=e.signatures[i];if(a)return a;throw new TypeError("Signature not found (signature: "+(e.name||"unnamed")+"("+r.join(", ")+"))")}function v(e,t){var r=m(e);if(t===r)return e;for(var n=0;n<N.conversions.length;n++){var i=N.conversions[n];if(i.from===r&&i.to===t)return i.convert(e)}throw new Error("Cannot convert from "+r+" to "+t)}i.prototype.add=function(e,t){var r=t||"fn";this.categories[r]||(this.categories[r]=[]);var n=this.categories[r].indexOf(e);return-1==n&&(n=this.categories[r].length,this.categories[r].push(e)),r+n},i.prototype.toCode=function(){var e=[],t=this.name+".categories",r=this.categories;for(var n in r)if(r.hasOwnProperty(n))for(var i=r[n],a=0;a<i.length;a++)e.push("var "+n+a+" = "+t+"['"+n+"']["+a+"];");return e.join("\n")},a.compare=function(e,t){if(e.anyType)return 1;if(t.anyType)return-1;if(d(e.types,"Object"))return 1;if(d(t.types,"Object"))return-1;if(e.hasConversions()){if(t.hasConversions()){var r,n,i;for(r=0;r<e.conversions.length;r++)if(void 0!==e.conversions[r]){n=e.conversions[r];break}for(r=0;r<t.conversions.length;r++)if(void 0!==t.conversions[r]){i=t.conversions[r];break}return N.conversions.indexOf(n)-N.conversions.indexOf(i)}return 1}if(t.hasConversions())return-1;var a,o;for(r=0;r<N.types.length;r++)if(N.types[r].name===e.types[0]){a=r;break}for(r=0;r<N.types.length;r++)if(N.types[r].name===t.types[0]){o=r;break}return a-o},a.prototype.overlapping=function(e){for(var t=0;t<this.types.length;t++)if(d(e.types,this.types[t]))return!0;return!1},a.prototype.clone=function(){var e=new a(this.types.slice(),this.varArgs);return e.conversions=this.conversions.slice(),e},a.prototype.hasConversions=function(){return this.conversions.length>0},a.prototype.contains=function(e){for(var t=0;t<this.types.length;t++)if(e[this.types[t]])return!0;return!1},a.prototype.toString=function(e){for(var t=[],r={},n=0;n<this.types.length;n++){var i=this.conversions[n],a=e&&i?i.to:this.types[n];a in r||(r[a]=!0,t.push(a))}return(this.varArgs?"...":"")+t.join("|")},o.prototype.clone=function(){return new o(this.params.slice(),this.fn)},o.prototype.expand=function(){function e(r,n){if(n.length<r.params.length){var i,s,u,c=r.params[n.length];if(c.varArgs){for(s=c.clone(),i=0;i<N.conversions.length;i++)if(u=N.conversions[i],!d(c.types,u.from)&&d(c.types,u.to)){var f=s.types.length;s.types[f]=u.from,s.conversions[f]=u}e(r,n.concat(s))}else{for(i=0;i<c.types.length;i++)e(r,n.concat(new a(c.types[i])));for(i=0;i<N.conversions.length;i++)u=N.conversions[i],!d(c.types,u.from)&&d(c.types,u.to)&&(s=new a(u.from),s.conversions[0]=u,e(r,n.concat(s)))}}else t.push(new o(n,r.fn))}var t=[];return e(this,[]),t},o.compare=function(e,t){if(e.params.length>t.params.length)return 1;if(e.params.length<t.params.length)return-1;var r,n=e.params.length,i=0,o=0;for(r=0;n>r;r++)e.params[r].hasConversions()&&i++,t.params[r].hasConversions()&&o++;if(i>o)return 1;if(o>i)return-1;for(r=0;r<e.params.length;r++){var s=a.compare(e.params[r],t.params[r]);if(0!==s)return s}return 0},o.prototype.hasConversions=function(){for(var e=0;e<this.params.length;e++)if(this.params[e].hasConversions())return!0;return!1},o.prototype.ignore=function(){for(var e={},t=0;t<N.ignore.length;t++)e[N.ignore[t]]=!0;for(t=0;t<this.params.length;t++)if(this.params[t].contains(e))return!0;return!1},o.prototype.toCode=function(e,t){for(var r=[],n=new Array(this.params.length),i=0;i<this.params.length;i++){var a=this.params[i],o=a.conversions[0];a.varArgs?n[i]="varArgs":o?n[i]=e.add(o.convert,"convert")+"(arg"+i+")":n[i]="arg"+i}var s=this.fn?e.add(this.fn,"signature"):void 0;return s?t+"return "+s+"("+n.join(", ")+"); // signature: "+this.params.join(", "):r.join("\n")},o.prototype.toString=function(){return this.params.join(", ")},s.prototype.toCode=function(e,r,n){var i=[];if(this.param){var a=this.path.length-1,o=this.param.conversions[0],s="// type: "+(o?o.from+" (convert to "+o.to+")":this.param);if(this.param.varArgs)if(this.param.anyType)i.push(r+"if (arguments.length > "+a+") {"),i.push(r+"  var varArgs = [];"),i.push(r+"  for (var i = "+a+"; i < arguments.length; i++) {"),i.push(r+"    varArgs.push(arguments[i]);"),i.push(r+"  }"),i.push(this.signature.toCode(e,r+"  ")),i.push(r+"}");else{for(var u=function(r,n){for(var i=[],a=0;a<r.length;a++)i[a]=e.add(t(r[a]),"test")+"("+n+")";return i.join(" || ")}.bind(this),c=this.param.types,f=[],l=0;l<c.length;l++)void 0===this.param.conversions[l]&&f.push(c[l]);i.push(r+"if ("+u(c,"arg"+a)+") { "+s),i.push(r+"  var varArgs = [arg"+a+"];"),i.push(r+"  for (var i = "+(a+1)+"; i < arguments.length; i++) {"),i.push(r+"    if ("+u(f,"arguments[i]")+") {"),i.push(r+"      varArgs.push(arguments[i]);");for(var l=0;l<c.length;l++){var p=this.param.conversions[l];if(p){var h=e.add(t(c[l]),"test"),m=e.add(p.convert,"convert");i.push(r+"    }"),i.push(r+"    else if ("+h+"(arguments[i])) {"),i.push(r+"      varArgs.push("+m+"(arguments[i]));")}}i.push(r+"    } else {"),i.push(r+"      throw createError(name, arguments.length, i, arguments[i], '"+f.join(",")+"');"),i.push(r+"    }"),i.push(r+"  }"),i.push(this.signature.toCode(e,r+"  ")),i.push(r+"}")}else if(this.param.anyType)i.push(r+"// type: any"),i.push(this._innerCode(e,r,n));else{var d=this.param.types[0],h="any"!==d?e.add(t(d),"test"):null;i.push(r+"if ("+h+"(arg"+a+")) { "+s),i.push(this._innerCode(e,r+"  ",n)),i.push(r+"}")}}else i.push(this._innerCode(e,r,n));return i.join("\n")},s.prototype._innerCode=function(e,t,r){var n,i=[];this.signature&&(i.push(t+"if (arguments.length === "+this.path.length+") {"),i.push(this.signature.toCode(e,t+"  ")),i.push(t+"}"));var a;for(n=0;n<this.childs.length;n++)if(this.childs[n].param.anyType){a=this.childs[n];break}for(n=0;n<this.childs.length;n++)i.push(this.childs[n].toCode(e,t,a));r&&!this.param.anyType&&i.push(r.toCode(e,t,a));var o=this._exceptions(e,t);return o&&i.push(o),i.join("\n")},s.prototype._exceptions=function(e,t){var r=this.path.length;if(0===this.childs.length)return[t+"if (arguments.length > "+r+") {",t+"  throw createError(name, arguments.length, "+r+", arguments["+r+"]);",t+"}"].join("\n");for(var n={},i=[],a=0;a<this.childs.length;a++){var o=this.childs[a];if(o.param)for(var s=0;s<o.param.types.length;s++){var u=o.param.types[s];u in n||o.param.conversions[s]||(n[u]=!0,i.push(u))}}return t+"throw createError(name, arguments.length, "+r+", arguments["+r+"], '"+i.join(",")+"');"};var y=[{name:"number",test:function(e){return"number"==typeof e}},{name:"string",test:function(e){return"string"==typeof e}},{name:"boolean",test:function(e){return"boolean"==typeof e}},{name:"Function",test:function(e){return"function"==typeof e}},{name:"Array",test:Array.isArray},{name:"Date",test:function(e){return e instanceof Date}},{name:"RegExp",test:function(e){return e instanceof RegExp}},{name:"Object",test:function(e){return"object"==typeof e}},{name:"null",test:function(e){return null===e}},{name:"undefined",test:function(e){return void 0===e}}],x={},b=[],w=[],N={config:x,types:y,conversions:b,ignore:w};return N=p("typed",{Object:function(e){var t=[];for(var n in e)e.hasOwnProperty(n)&&t.push(e[n]);var i=r(t);return p(i,e)},"string, Object":p,"...Function":function(e){for(var t,n=r(e),i={},a=0;a<e.length;a++){var o=e[a];if("object"!=typeof o.signatures)throw t=new TypeError("Function is no typed-function (index: "+a+")"),t.data={index:a},t;for(var s in o.signatures)if(o.signatures.hasOwnProperty(s))if(i.hasOwnProperty(s)){if(o.signatures[s]!==i[s])throw t=new Error('Signature "'+s+'" is defined twice'),t.data={signature:s},t}else i[s]=o.signatures[s]}return p(n,i)}}),N.config=x,N.types=y,N.conversions=b,N.ignore=w,N.create=e,N.find=g,N.convert=v,N.addType=function(e){if(!e||"string"!=typeof e.name||"function"!=typeof e.test)throw new TypeError("Object with properties {name: string, test: function} expected");N.types.push(e)},N.addConversion=function(e){if(!e||"string"!=typeof e.from||"string"!=typeof e.to||"function"!=typeof e.convert)throw new TypeError("Object with properties {from: string, to: string, convert: function} expected");N.conversions.push(e)},N}return e()})},function(e,t,r){"use strict";var n=r(7);t.isNumber=function(e){return"number"==typeof e},t.isInteger=function(e){return isFinite(e)?e==Math.round(e):!1},t.sign=Math.sign||function(e){return e>0?1:0>e?-1:0},t.format=function(e,r){if("function"==typeof r)return r(e);if(e===1/0)return"Infinity";if(e===-(1/0))return"-Infinity";if(isNaN(e))return"NaN";var n="auto",i=void 0;switch(r&&(r.notation&&(n=r.notation),t.isNumber(r)?i=r:r.precision&&(i=r.precision)),n){case"fixed":return t.toFixed(e,i);case"exponential":return t.toExponential(e,i);case"engineering":return t.toEngineering(e,i);case"auto":return t.toPrecision(e,i,r&&r.exponential).replace(/((\.\d*?)(0+))($|e)/,function(){var e=arguments[2],t=arguments[4];return"."!==e?e+t:t});default:throw new Error('Unknown notation "'+n+'". Choose "auto", "exponential", or "fixed".')}},t.toExponential=function(e,t){return new n(e).toExponential(t)},t.toEngineering=function(e,t){return new n(e).toEngineering(t)},t.toFixed=function(e,t){return new n(e).toFixed(t)},t.toPrecision=function(e,t,r){return new n(e).toPrecision(t,r)},t.digits=function(e){return e.toExponential().replace(/e.*$/,"").replace(/^0\.?0*|\./,"").length},t.DBL_EPSILON=Number.EPSILON||2.220446049250313e-16,t.nearlyEqual=function(e,r,n){if(null==n)return e==r;if(e==r)return!0;if(isNaN(e)||isNaN(r))return!1;if(isFinite(e)&&isFinite(r)){var i=Math.abs(e-r);return i<t.DBL_EPSILON?!0:i<=Math.max(Math.abs(e),Math.abs(r))*n}return!1}},function(e,t){"use strict";function r(e){var t=String(e).toLowerCase().match(/^0*?(-?)(\d+\.?\d*)(e([+-]?\d+))?$/);if(!t)throw new SyntaxError("Invalid number");var r=t[1],n=t[2],i=parseFloat(t[4]||"0"),a=n.indexOf(".");i+=-1!==a?a-1:n.length-1,this.sign=r,this.coefficients=n.replace(".","").replace(/^0*/,function(e){return i-=e.length,""}).replace(/0*$/,"").split("").map(function(e){return parseInt(e)}),0===this.coefficients.length&&(this.coefficients.push(0),i++),this.exponent=i}function n(e){for(var t=[],r=0;e>r;r++)t.push(0);return t}r.prototype.toEngineering=function(e){var t=this.roundDigits(e),r=t.exponent,i=t.coefficients,a=r%3===0?r:0>r?r-3-r%3:r-r%3,o=r>=0?r:Math.abs(a);i.length-1<o&&(i=i.concat(n(o-(i.length-1))));for(var s=Math.abs(r-a),u=1,c="";--s>=0;)u++;var f=i.slice(u).join(""),l=f.match(/[1-9]/)?"."+f:"";return c=i.slice(0,u).join("")+l,c+="e"+(r>=0?"+":"")+a.toString(),t.sign+c},r.prototype.toFixed=function(e){var t=this.roundDigits(this.exponent+1+(e||0)),r=t.coefficients,i=t.exponent+1,a=i+(e||0);return r.length<a&&(r=r.concat(n(a-r.length))),0>i&&(r=n(-i+1).concat(r),i=1),e&&r.splice(i,0,0===i?"0.":"."),this.sign+r.join("")},r.prototype.toExponential=function(e){var t=e?this.roundDigits(e):this.clone(),r=t.coefficients,i=t.exponent;r.length<e&&(r=r.concat(n(e-r.length)));var a=r.shift();return this.sign+a+(r.length>0?"."+r.join(""):"")+"e"+(i>=0?"+":"")+i},r.prototype.toPrecision=function(e,t){var r=t&&void 0!==t.lower?t.lower:.001,i=t&&void 0!==t.upper?t.upper:1e5,a=Math.abs(Math.pow(10,this.exponent));if(r>a||a>=i)return this.toExponential(e);var o=e?this.roundDigits(e):this.clone(),s=o.coefficients,u=o.exponent;s.length<e&&(s=s.concat(n(e-s.length))),s=s.concat(n(u-s.length+1+(s.length<e?e-s.length:0))),s=n(-u).concat(s);var c=u>0?u:0;return c<s.length-1&&s.splice(c+1,0,"."),this.sign+s.join("")},r.prototype.clone=function(){var e=new r("0");return e.sign=this.sign,e.coefficients=this.coefficients.slice(0),e.exponent=this.exponent,e},r.prototype.roundDigits=function(e){for(var t=this.clone(),r=t.coefficients;0>=e;)r.unshift(0),t.exponent++,e++;if(r.length>e){var n=r.splice(e,r.length-e);if(n[0]>=5){var i=e-1;for(r[i]++;10===r[i];)r.pop(),0===i&&(r.unshift(0),t.exponent++,i++),i--,r[i]++}}return t},e.exports=r},function(e,t,r){var n=r(9);t.mixin=function(e){var t=new n;return e.on=t.on.bind(t),e.off=t.off.bind(t),e.once=t.once.bind(t),e.emit=t.emit.bind(t),e}},function(e,t){function r(){}r.prototype={on:function(e,t,r){var n=this.e||(this.e={});return(n[e]||(n[e]=[])).push({fn:t,ctx:r}),this},once:function(e,t,r){function n(){i.off(e,n),t.apply(r,arguments)}var i=this;return n._=t,this.on(e,n,r)},emit:function(e){var t=[].slice.call(arguments,1),r=((this.e||(this.e={}))[e]||[]).slice(),n=0,i=r.length;for(n;i>n;n++)r[n].fn.apply(r[n].ctx,t);return this},off:function(e,t){var r=this.e||(this.e={}),n=r[e],i=[];if(n&&t)for(var a=0,o=n.length;o>a;a++)n[a].fn!==t&&n[a].fn._!==t&&i.push(n[a]);return i.length?r[e]=i:delete r[e],this}},e.exports=r},function(e,t,r){"use strict";function n(e,t,r,n,u){function c(e,t){var r=arguments.length;if(1!=r&&2!=r)throw new s("import",r,1,2);if(t||(t={}),a(e))h(e,t);else if(Array.isArray(e))e.forEach(function(e){c(e,t)});else if("object"==typeof e){for(var n in e)if(e.hasOwnProperty(n)){var i=e[n];m(i)?f(n,i,t):a(e)?h(e,t):c(i,t)}}else if(!t.silent)throw new TypeError("Factory, Object, or Array expected")}function f(e,t,r){if(r.wrap&&"function"==typeof t&&(t=p(t)),d(u[e])&&d(t))return t=r.override?n(e,t.signatures):n(u[e],t),u[e]=t,l(e,t),void u.emit("import",e,function(){return t});if(void 0===u[e]||r.override)return u[e]=t,l(e,t),void u.emit("import",e,function(){return t});if(!r.silent)throw new Error('Cannot import "'+e+'": already exists')}function l(e,t){t&&"function"==typeof t.transform&&(u.expression.transform[e]=t.transform)}function p(e){var t=function(){for(var t=[],r=0,n=arguments.length;n>r;r++){var i=arguments[r];t[r]=i&&i.valueOf()}return e.apply(u,t)};return e.transform&&(t.transform=e.transform),t}function h(e,t){if("string"==typeof e.name){var a=e.name,s=e.path?o(u,e.path):u,c=s.hasOwnProperty(a)?s[a]:void 0,f=function(){var i=r(e);if(d(c)&&d(i))return t.override||(i=n(c,i)),i;if(void 0===c||t.override)return i;if(!t.silent)throw new Error('Cannot import "'+a+'": already exists')};e.lazy!==!1?i(s,a,f):s[a]=f(),u.emit("import",a,f,e.path)}else r(e)}function m(e){return"function"==typeof e||"number"==typeof e||"string"==typeof e||"boolean"==typeof e||null===e||e&&e.isUnit===!0||e&&e.isComplex===!0||e&&e.isBigNumber===!0||e&&e.isFraction===!0||e&&e.isMatrix===!0||e&&Array.isArray(e)===!0}function d(e){return"function"==typeof e&&"object"==typeof e.signatures}return c}var i=r(3).lazy,a=r(3).isFactory,o=r(3).traverse,s=(r(3).extend,r(11));t.math=!0,t.name="import",t.factory=n,t.lazy=!0},function(e,t){"use strict";function r(e,t,n,i){if(!(this instanceof r))throw new SyntaxError("Constructor must be called with the new operator");this.fn=e,this.count=t,this.min=n,this.max=i,this.message="Wrong number of arguments in function "+e+" ("+t+" provided, "+n+(void 0!=i?"-"+i:"")+" expected)",this.stack=(new Error).stack}r.prototype=new Error,r.prototype.constructor=Error,r.prototype.name="ArgumentsError",r.prototype.isArgumentsError=!0,e.exports=r},function(e,t,r){"use strict";function n(e,t,r,n,i){function a(e){if(e){var r=s.clone(t);o(e,"matrix",u),o(e,"number",c),s.deepExtend(t,e);var n=s.clone(t);return i.emit("config",n,r),n}return s.clone(t)}var u=["Matrix","Array"],c=["number","BigNumber","Fraction"];return a.MATRIX=u,a.NUMBER=c,a}function i(e,t){return-1!==e.indexOf(t)}function a(e,t){return e.map(function(e){return e.toLowerCase()}).indexOf(t.toLowerCase())}function o(e,t,r){if(void 0!==e[t]&&!i(r,e[t])){var n=a(r,e[t]);-1!==n?(console.warn('Warning: Wrong casing for configuration option "'+t+'", should be "'+r[n]+'" instead of "'+e[t]+'".'),e[t]=r[n]):console.warn('Warning: Unknown value "'+e[t]+'" for configuration option "'+t+'". Available options: '+r.map(JSON.stringify).join(", ")+".")}}var s=r(3);t.name="config",t.math=!0,t.factory=n},function(e,t,r){e.exports=[r(14),r(93),r(95),r(326),r(489),r(491)]},function(e,t,r){e.exports=[r(15),r(20),r(21),r(26),r(33),r(37),r(70),r(71),r(73),r(74)]},function(e,t,r){e.exports=[r(16),r(18)]},function(e,t,r){function n(e,t,r,n,a){var o=i.clone({precision:t.precision});return o.prototype.type="BigNumber",o.prototype.isBigNumber=!0,o.prototype.toJSON=function(){return{mathjs:"BigNumber",value:this.toString()}},o.fromJSON=function(e){return new o(e.value)},a.on("config",function(e,t){e.precision!==t.precision&&o.config({precision:e.precision})}),o}var i=r(17);t.name="BigNumber",t.path="type",t.factory=n,t.math=!0},function(e,t,r){var n;!function(i){"use strict";function a(e){var t,r,n,i=e.length-1,a="",o=e[0];if(i>0){for(a+=o,t=1;i>t;t++)n=e[t]+"",r=Re-n.length,r&&(a+=g(r)),a+=n;o=e[t],n=o+"",r=Re-n.length,r&&(a+=g(r))}else if(0===o)return"0";for(;o%10===0;)o/=10;return a+o}function o(e,t,r){if(e!==~~e||t>e||e>r)throw Error(_e+e)}function s(e,t,r,n){var i,a,o,s;for(a=e[0];a>=10;a/=10)--t;return--t<0?(t+=Re,i=0):(i=Math.ceil((t+1)/Re),t%=Re),a=Ce(10,Re-t),s=e[i]%a|0,null==n?3>t?(0==t?s=s/100|0:1==t&&(s=s/10|0),o=4>r&&99999==s||r>3&&49999==s||5e4==s||0==s):o=(4>r&&s+1==a||r>3&&s+1==a/2)&&(e[i+1]/a/100|0)==Ce(10,t-2)-1||(s==a/2||0==s)&&0==(e[i+1]/a/100|0):4>t?(0==t?s=s/1e3|0:1==t?s=s/100|0:2==t&&(s=s/10|0),o=(n||4>r)&&9999==s||!n&&r>3&&4999==s):o=((n||4>r)&&s+1==a||!n&&r>3&&s+1==a/2)&&(e[i+1]/a/1e3|0)==Ce(10,t-3)-1,o}function u(e,t,r){for(var n,i,a=[0],o=0,s=e.length;s>o;){for(i=a.length;i--;)a[i]*=t;for(a[0]+=xe.indexOf(e.charAt(o++)),n=0;n<a.length;n++)a[n]>r-1&&(void 0===a[n+1]&&(a[n+1]=0),a[n+1]+=a[n]/r|0,a[n]%=r)}return a.reverse()}function c(e,t){var r,n,i=t.d.length;32>i?(r=Math.ceil(i/3),n=Math.pow(4,-r).toString()):(r=16,n="2.3283064365386962890625e-10"),e.precision+=r,t=_(e,1,t.times(n),new e(1));for(var a=r;a--;){var o=t.times(t);t=o.times(o).minus(o).times(8).plus(1)}return e.precision-=r,t}function f(e,t,r,n){var i,a,o,s,u,c,f,l,p,h=e.constructor;e:if(null!=t){if(l=e.d,!l)return e;for(i=1,s=l[0];s>=10;s/=10)i++;if(a=t-i,0>a)a+=Re,o=t,f=l[p=0],u=f/Ce(10,i-o-1)%10|0;else if(p=Math.ceil((a+1)/Re),s=l.length,p>=s){if(!n)break e;for(;s++<=p;)l.push(0);f=u=0,i=1,a%=Re,o=a-Re+1}else{for(f=s=l[p],i=1;s>=10;s/=10)i++;a%=Re,o=a-Re+i,u=0>o?0:f/Ce(10,i-o-1)%10|0}if(n=n||0>t||void 0!==l[p+1]||(0>o?f:f%Ce(10,i-o-1)),c=4>r?(u||n)&&(0==r||r==(e.s<0?3:2)):u>5||5==u&&(4==r||n||6==r&&(a>0?o>0?f/Ce(10,i-o):0:l[p-1])%10&1||r==(e.s<0?8:7)),1>t||!l[0])return l.length=0,c?(t-=e.e+1,l[0]=Ce(10,(Re-t%Re)%Re),e.e=-t||0):l[0]=e.e=0,e;if(0==a?(l.length=p,s=1,p--):(l.length=p+1,s=Ce(10,Re-a),l[p]=o>0?(f/Ce(10,i-o)%Ce(10,o)|0)*s:0),c)for(;;){if(0==p){for(a=1,o=l[0];o>=10;o/=10)a++;for(o=l[0]+=s,s=1;o>=10;o/=10)s++;a!=s&&(e.e++,l[0]==Ie&&(l[0]=1));break}if(l[p]+=s,l[p]!=Ie)break;l[p--]=0,s=1}for(a=l.length;0===l[--a];)l.pop()}return Me&&(e.e>h.maxE?(e.d=null,e.e=NaN):e.e<h.minE&&(e.e=0,e.d=[0])),e}function l(e,t,r){if(!e.isFinite())return N(e);var n,i=e.e,o=a(e.d),s=o.length;return t?(r&&(n=r-s)>0?o=o.charAt(0)+"."+o.slice(1)+g(n):s>1&&(o=o.charAt(0)+"."+o.slice(1)),o=o+(e.e<0?"e":"e+")+e.e):0>i?(o="0."+g(-i-1)+o,r&&(n=r-s)>0&&(o+=g(n))):i>=s?(o+=g(i+1-s),r&&(n=r-i-1)>0&&(o=o+"."+g(n))):((n=i+1)<s&&(o=o.slice(0,n)+"."+o.slice(n)),r&&(n=r-s)>0&&(i+1===s&&(o+="."),o+=g(n))),o}function p(e,t){for(var r=1,n=e[0];n>=10;n/=10)r++;return r+t*Re-1}function h(e,t,r){if(t>Ue)throw Me=!0,r&&(e.precision=r),Error(Oe);return f(new e(be),t,1,!0)}function m(e,t,r){if(t>qe)throw Error(Oe);return f(new e(we),t,r,!0)}function d(e){var t=e.length-1,r=t*Re+1;if(t=e[t]){for(;t%10==0;t/=10)r--;for(t=e[0];t>=10;t/=10)r++}return r}function g(e){for(var t="";e--;)t+="0";return t}function v(e,t,r,n){var i,a=new e(1),o=Math.ceil(n/Re+4);for(Me=!1;;){if(r%2&&(a=a.times(t),C(a.d,o)&&(i=!0)),r=Te(r/2),0===r){r=a.d.length-1,i&&0===a.d[r]&&++a.d[r];break}t=t.times(t),C(t.d,o)}return Me=!0,a}function y(e){return 1&e.d[e.d.length-1]}function x(e,t,r){for(var n,i=new e(t[0]),a=0;++a<t.length;){if(n=new e(t[a]),!n.s){i=n;break}i[r](n)&&(i=n)}return i}function b(e,t){var r,n,i,o,u,c,l,p=0,h=0,m=0,d=e.constructor,g=d.rounding,v=d.precision;if(!e.d||!e.d[0]||e.e>17)return new d(e.d?e.d[0]?e.s<0?0:1/0:1:e.s?e.s<0?0:e:NaN);for(null==t?(Me=!1,l=v):l=t,c=new d(.03125);e.e>-2;)e=e.times(c),m+=5;for(n=Math.log(Ce(2,m))/Math.LN10*2+5|0,l+=n,r=o=u=new d(1),d.precision=l;;){if(o=f(o.times(e),l,1),r=r.times(++h),c=u.plus(je(o,r,l,1)),a(c.d).slice(0,l)===a(u.d).slice(0,l)){for(i=m;i--;)u=f(u.times(u),l,1);if(null!=t)return d.precision=v,u;if(!(3>p&&s(u.d,l-n,g,p)))return f(u,d.precision=v,g,Me=!0);d.precision=l+=10,r=o=c=new d(1),h=0,p++}u=c}}function w(e,t){var r,n,i,o,u,c,l,p,m,d,g,v=1,y=10,x=e,b=x.d,N=x.constructor,E=N.rounding,M=N.precision;if(x.s<0||!b||!b[0]||!x.e&&1==b[0]&&1==b.length)return new N(b&&!b[0]?-1/0:1!=x.s?NaN:b?0:x);if(null==t?(Me=!1,m=M):m=t,N.precision=m+=y,r=a(b),n=r.charAt(0),!(Math.abs(o=x.e)<15e14))return p=h(N,m+2,M).times(o+""),x=w(new N(n+"."+r.slice(1)),m-y).plus(p),N.precision=M,null==t?f(x,M,E,Me=!0):x;for(;7>n&&1!=n||1==n&&r.charAt(1)>3;)x=x.times(e),r=a(x.d),n=r.charAt(0),v++;for(o=x.e,n>1?(x=new N("0."+r),o++):x=new N(n+"."+r.slice(1)),d=x,l=u=x=je(x.minus(1),x.plus(1),m,1),g=f(x.times(x),m,1),i=3;;){if(u=f(u.times(g),m,1),p=l.plus(je(u,new N(i),m,1)),a(p.d).slice(0,m)===a(l.d).slice(0,m)){
if(l=l.times(2),0!==o&&(l=l.plus(h(N,m+2,M).times(o+""))),l=je(l,new N(v),m,1),null!=t)return N.precision=M,l;if(!s(l.d,m-y,E,c))return f(l,N.precision=M,E,Me=!0);N.precision=m+=y,p=u=x=je(d.minus(1),d.plus(1),m,1),g=f(x.times(x),m,1),i=c=1}l=p,i+=2}}function N(e){return String(e.s*e.s/0)}function E(e,t){var r,n,i;for((r=t.indexOf("."))>-1&&(t=t.replace(".","")),(n=t.search(/e/i))>0?(0>r&&(r=n),r+=+t.slice(n+1),t=t.substring(0,n)):0>r&&(r=t.length),n=0;48===t.charCodeAt(n);n++);for(i=t.length;48===t.charCodeAt(i-1);--i);if(t=t.slice(n,i)){if(i-=n,e.e=r=r-n-1,e.d=[],n=(r+1)%Re,0>r&&(n+=Re),i>n){for(n&&e.d.push(+t.slice(0,n)),i-=Re;i>n;)e.d.push(+t.slice(n,n+=Re));t=t.slice(n),n=Re-t.length}else n-=i;for(;n--;)t+="0";e.d.push(+t),Me&&(e.e>e.constructor.maxE?(e.d=null,e.e=NaN):e.e<e.constructor.minE&&(e.e=0,e.d=[0]))}else e.e=0,e.d=[0];return e}function M(e,t){var r,n,i,a,o,s,c,f,l;if("Infinity"===t||"NaN"===t)return+t||(e.s=NaN),e.e=NaN,e.d=null,e;if(ze.test(t))r=16,t=t.toLowerCase();else if(Se.test(t))r=2;else{if(!Be.test(t))throw Error(_e+t);r=8}for(a=t.search(/p/i),a>0?(c=+t.slice(a+1),t=t.substring(2,a)):t=t.slice(2),a=t.indexOf("."),o=a>=0,n=e.constructor,o&&(t=t.replace(".",""),s=t.length,a=s-a,i=v(n,new n(r),a,2*a)),f=u(t,r,Ie),l=f.length-1,a=l;0===f[a];--a)f.pop();return 0>a?new n(0*e.s):(e.e=p(f,l),e.d=f,Me=!1,o&&(e=je(e,i,4*s)),c&&(e=e.times(Math.abs(c)<54?Math.pow(2,c):Ne.pow(2,c))),Me=!0,e)}function A(e,t){var r,n=t.d.length;if(3>n)return _(e,2,t,t);r=1.4*Math.sqrt(n),r=r>16?16:0|r,t=t.times(Math.pow(5,-r)),t=_(e,2,t,t);for(var i,a=new e(5),o=new e(16),s=new e(20);r--;)i=t.times(t),t=t.times(a.plus(i.times(o.times(i).minus(s))));return t}function _(e,t,r,n,i){var a,o,s,u,c=1,f=e.precision,l=Math.ceil(f/Re);for(Me=!1,u=r.times(r),s=new e(n);;){if(o=je(s.times(u),new e(t++*t++),f,1),s=i?n.plus(o):n.minus(o),n=je(o.times(u),new e(t++*t++),f,1),o=s.plus(n),void 0!==o.d[l]){for(a=l;o.d[a]===s.d[a]&&a--;);if(-1==a)break}a=s,s=n,n=o,o=a,c++}return Me=!0,o.d.length=l+1,o}function O(e,t){var r,n=t.s<0,i=m(e,e.precision,1),a=i.times(.5);if(t=t.abs(),t.lte(a))return ge=n?4:1,t;if(r=t.divToInt(i),r.isZero())ge=n?3:2;else{if(t=t.minus(r.times(i)),t.lte(a))return ge=y(r)?n?2:3:n?4:1,t;ge=y(r)?n?1:4:n?3:2}return t.minus(i).abs()}function T(e,t,r,n){var i,a,s,c,f,p,h,m,d,g=e.constructor,v=void 0!==r;if(v?(o(r,1,ye),void 0===n?n=g.rounding:o(n,0,8)):(r=g.precision,n=g.rounding),e.isFinite()){for(h=l(e),s=h.indexOf("."),v?(i=2,16==t?r=4*r-3:8==t&&(r=3*r-2)):i=t,s>=0&&(h=h.replace(".",""),d=new g(1),d.e=h.length-s,d.d=u(l(d),10,i),d.e=d.d.length),m=u(h,10,i),a=f=m.length;0==m[--f];)m.pop();if(m[0]){if(0>s?a--:(e=new g(e),e.d=m,e.e=a,e=je(e,d,r,n,0,i),m=e.d,a=e.e,p=de),s=m[r],c=i/2,p=p||void 0!==m[r+1],p=4>n?(void 0!==s||p)&&(0===n||n===(e.s<0?3:2)):s>c||s===c&&(4===n||p||6===n&&1&m[r-1]||n===(e.s<0?8:7)),m.length=r,p)for(;++m[--r]>i-1;)m[r]=0,r||(++a,m.unshift(1));for(f=m.length;!m[f-1];--f);for(s=0,h="";f>s;s++)h+=xe.charAt(m[s]);if(v){if(f>1)if(16==t||8==t){for(s=16==t?4:3,--f;f%s;f++)h+="0";for(m=u(h,i,t),f=m.length;!m[f-1];--f);for(s=1,h="1.";f>s;s++)h+=xe.charAt(m[s])}else h=h.charAt(0)+"."+h.slice(1);h=h+(0>a?"p":"p+")+a}else if(0>a){for(;++a;)h="0"+h;h="0."+h}else if(++a>f)for(a-=f;a--;)h+="0";else f>a&&(h=h.slice(0,a)+"."+h.slice(a))}else h=v?"0p+0":"0";h=(16==t?"0x":2==t?"0b":8==t?"0o":"")+h}else h=N(e);return e.s<0?"-"+h:h}function C(e,t){return e.length>t?(e.length=t,!0):void 0}function S(e){return new this(e).abs()}function z(e){return new this(e).acos()}function B(e){return new this(e).acosh()}function k(e,t){return new this(e).plus(t)}function I(e){return new this(e).asin()}function R(e){return new this(e).asinh()}function P(e){return new this(e).atan()}function U(e){return new this(e).atanh()}function q(e,t){e=new this(e),t=new this(t);var r,n=this.precision,i=this.rounding,a=n+4;return e.s&&t.s?e.d||t.d?!t.d||e.isZero()?(r=t.s<0?m(this,n,i):new this(0),r.s=e.s):!e.d||t.isZero()?(r=m(this,a,1).times(.5),r.s=e.s):t.s<0?(this.precision=a,this.rounding=1,r=this.atan(je(e,t,a,1)),t=m(this,a,1),this.precision=n,this.rounding=i,r=e.s<0?r.minus(t):r.plus(t)):r=this.atan(je(e,t,a,1)):(r=m(this,a,1).times(t.s>0?.25:.75),r.s=e.s):r=new this(NaN),r}function L(e){return new this(e).cbrt()}function j(e){return f(e=new this(e),e.e+1,2)}function F(e){if(!e||"object"!=typeof e)throw Error(Ae+"Object expected");var t,r,n,i=["precision",1,ye,"rounding",0,8,"toExpNeg",-ve,0,"toExpPos",0,ve,"maxE",0,ve,"minE",-ve,0,"modulo",0,9];for(t=0;t<i.length;t+=3)if(void 0!==(n=e[r=i[t]])){if(!(Te(n)===n&&n>=i[t+1]&&n<=i[t+2]))throw Error(_e+r+": "+n);this[r]=n}if(e.hasOwnProperty(r="crypto"))if(void 0===(n=e[r]))this[r]=n;else{if(n!==!0&&n!==!1&&0!==n&&1!==n)throw Error(_e+r+": "+n);this[r]=!(!n||!Ee||!Ee.getRandomValues&&!Ee.randomBytes)}return this}function D(e){return new this(e).cos()}function $(e){return new this(e).cosh()}function G(e){function t(e){var r,n,i,a=this;if(!(a instanceof t))return new t(e);if(a.constructor=t,e instanceof t)return a.s=e.s,a.e=e.e,void(a.d=(e=e.d)?e.slice():e);if(i=typeof e,"number"===i){if(0===e)return a.s=0>1/e?-1:1,a.e=0,void(a.d=[0]);if(0>e?(e=-e,a.s=-1):a.s=1,e===~~e&&1e7>e){for(r=0,n=e;n>=10;n/=10)r++;return a.e=r,void(a.d=[e])}return 0*e!==0?(e||(a.s=NaN),a.e=NaN,void(a.d=null)):E(a,e.toString())}if("string"!==i)throw Error(_e+e);return 45===e.charCodeAt(0)?(e=e.slice(1),a.s=-1):a.s=1,ke.test(e)?E(a,e):M(a,e)}var r,n,i;if(t.prototype=Le,t.ROUND_UP=0,t.ROUND_DOWN=1,t.ROUND_CEIL=2,t.ROUND_FLOOR=3,t.ROUND_HALF_UP=4,t.ROUND_HALF_DOWN=5,t.ROUND_HALF_EVEN=6,t.ROUND_HALF_CEIL=7,t.ROUND_HALF_FLOOR=8,t.EUCLID=9,t.config=F,t.clone=G,t.abs=S,t.acos=z,t.acosh=B,t.add=k,t.asin=I,t.asinh=R,t.atan=P,t.atanh=U,t.atan2=q,t.cbrt=L,t.ceil=j,t.cos=D,t.cosh=$,t.div=H,t.exp=V,t.floor=Z,t.fromJSON=W,t.hypot=Y,t.ln=X,t.log=J,t.log10=K,t.log2=Q,t.max=ee,t.min=te,t.mod=re,t.mul=ne,t.pow=ie,t.random=ae,t.round=oe,t.sign=se,t.sin=ue,t.sinh=ce,t.sqrt=fe,t.sub=le,t.tan=pe,t.tanh=he,t.trunc=me,void 0===e&&(e={}),e)for(i=["precision","rounding","toExpNeg","toExpPos","maxE","minE","modulo","crypto"],r=0;r<i.length;)e.hasOwnProperty(n=i[r++])||(e[n]=this[n]);return t.config(e),t}function H(e,t){return new this(e).div(t)}function V(e){return new this(e).exp()}function Z(e){return f(e=new this(e),e.e+1,3)}function W(e){var t,r,n,i;if("string"!=typeof e||!e)throw Error(_e+e);if(n=e.length,i=xe.indexOf(e.charAt(0)),1===n)return new this(i>81?[-1/0,1/0,NaN][i-82]:i>40?-(i-41):i);if(64&i)r=16&i,t=r?(7&i)-3:(15&i)-7,n=1;else{if(2===n)return i=88*i+xe.indexOf(e.charAt(1)),new this(i>=2816?-(i-2816)-41:i+41);if(r=32&i,!(31&i))return e=u(e.slice(1),88,10).join(""),new this(r?"-"+e:e);t=15&i,n=t+1,t=1===t?xe.indexOf(e.charAt(1)):2===t?88*xe.indexOf(e.charAt(1))+xe.indexOf(e.charAt(2)):+u(e.slice(1,n),88,10).join(""),16&i&&(t=-t)}return e=u(e.slice(n),88,10).join(""),t=t-e.length+1,e=e+"e"+t,new this(r?"-"+e:e)}function Y(){var e,t,r=new this(0);for(Me=!1,e=0;e<arguments.length;)if(t=new this(arguments[e++]),t.d)r.d&&(r=r.plus(t.times(t)));else{if(t.s)return Me=!0,new this(1/0);r=t}return Me=!0,r.sqrt()}function X(e){return new this(e).ln()}function J(e,t){return new this(e).log(t)}function Q(e){return new this(e).log(2)}function K(e){return new this(e).log(10)}function ee(){return x(this,arguments,"lt")}function te(){return x(this,arguments,"gt")}function re(e,t){return new this(e).mod(t)}function ne(e,t){return new this(e).mul(t)}function ie(e,t){return new this(e).pow(t)}function ae(e){var t,r,n,i,a=0,s=new this(1),u=[];if(void 0===e?e=this.precision:o(e,1,ye),n=Math.ceil(e/Re),this.crypto===!1)for(;n>a;)u[a++]=1e7*Math.random()|0;else if(Ee&&Ee.getRandomValues)for(t=Ee.getRandomValues(new Uint32Array(n));n>a;)i=t[a],i>=429e7?t[a]=Ee.getRandomValues(new Uint32Array(1))[0]:u[a++]=i%1e7;else if(Ee&&Ee.randomBytes){for(t=Ee.randomBytes(n*=4);n>a;)i=t[a]+(t[a+1]<<8)+(t[a+2]<<16)+((127&t[a+3])<<24),i>=214e7?Ee.randomBytes(4).copy(t,a):(u.push(i%1e7),a+=4);a=n/4}else{if(this.crypto)throw Error(Ae+"crypto unavailable");for(;n>a;)u[a++]=1e7*Math.random()|0}for(n=u[--a],e%=Re,n&&e&&(i=Ce(10,Re-e),u[a]=(n/i|0)*i);0===u[a];a--)u.pop();if(0>a)r=0,u=[0];else{for(r=-1;0===u[0];r-=Re)u.shift();for(n=1,i=u[0];i>=10;i/=10)n++;Re>n&&(r-=Re-n)}return s.e=r,s.d=u,s}function oe(e){return f(e=new this(e),e.e+1,this.rounding)}function se(e){return e=new this(e),e.d?e.d[0]?e.s:0*e.s:e.s||NaN}function ue(e){return new this(e).sin()}function ce(e){return new this(e).sinh()}function fe(e){return new this(e).sqrt()}function le(e,t){return new this(e).sub(t)}function pe(e){return new this(e).tan()}function he(e){return new this(e).tanh()}function me(e){return f(e=new this(e),e.e+1,1)}var de,ge,ve=9e15,ye=1e9,xe="0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%()*+,-./:;=?@[]^_`{|}~",be="2.3025850929940456840179914546843642076011014886287729760333279009675726096773524802359972050895982983419677840422862486334095254650828067566662873690987816894829072083255546808437998948262331985283935053089653777326288461633662222876982198867465436674744042432743651550489343149393914796194044002221051017141748003688084012647080685567743216228355220114804663715659121373450747856947683463616792101806445070648000277502684916746550586856935673420670581136429224554405758925724208241314695689016758940256776311356919292033376587141660230105703089634572075440370847469940168269282808481184289314848524948644871927809676271275775397027668605952496716674183485704422507197965004714951050492214776567636938662976979522110718264549734772662425709429322582798502585509785265383207606726317164309505995087807523710333101197857547331541421808427543863591778117054309827482385045648019095610299291824318237525357709750539565187697510374970888692180205189339507238539205144634197265287286965110862571492198849978748873771345686209167058",we="3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989380952572010654858632789",Ne={precision:20,rounding:4,modulo:1,toExpNeg:-7,toExpPos:21,minE:-ve,maxE:ve,crypto:void 0},Ee="undefined"!=typeof crypto?crypto:null,Me=!0,Ae="[DecimalError] ",_e=Ae+"Invalid argument: ",Oe=Ae+"Precision limit exceeded",Te=Math.floor,Ce=Math.pow,Se=/^0b([01]+(\.[01]*)?|\.[01]+)(p[+-]?\d+)?$/i,ze=/^0x([0-9a-f]+(\.[0-9a-f]*)?|\.[0-9a-f]+)(p[+-]?\d+)?$/i,Be=/^0o([0-7]+(\.[0-7]*)?|\.[0-7]+)(p[+-]?\d+)?$/i,ke=/^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i,Ie=1e7,Re=7,Pe=9007199254740991,Ue=be.length-1,qe=we.length-1,Le={};Le.absoluteValue=Le.abs=function(){var e=new this.constructor(this);return e.s<0&&(e.s=1),f(e)},Le.ceil=function(){return f(new this.constructor(this),this.e+1,2)},Le.comparedTo=Le.cmp=function(e){var t,r,n,i,a=this,o=a.d,s=(e=new a.constructor(e)).d,u=a.s,c=e.s;if(!o||!s)return u&&c?u!==c?u:o===s?0:!o^0>u?1:-1:NaN;if(!o[0]||!s[0])return o[0]?u:s[0]?-c:0;if(u!==c)return u;if(a.e!==e.e)return a.e>e.e^0>u?1:-1;for(n=o.length,i=s.length,t=0,r=i>n?n:i;r>t;++t)if(o[t]!==s[t])return o[t]>s[t]^0>u?1:-1;return n===i?0:n>i^0>u?1:-1},Le.cosine=Le.cos=function(){var e,t,r=this,n=r.constructor;return r.d?r.d[0]?(e=n.precision,t=n.rounding,n.precision=e+Math.max(r.e,r.sd())+Re,n.rounding=1,r=c(n,O(n,r)),n.precision=e,n.rounding=t,f(2==ge||3==ge?r.neg():r,e,t,!0)):new n(1):new n(NaN)},Le.cubeRoot=Le.cbrt=function(){var e,t,r,n,i,o,s,u,c,l,p=this,h=p.constructor;if(!p.isFinite()||p.isZero())return new h(p);for(Me=!1,o=p.s*Math.pow(p.s*p,1/3),o&&Math.abs(o)!=1/0?n=new h(o.toString()):(r=a(p.d),e=p.e,(o=(e-r.length+1)%3)&&(r+=1==o||-2==o?"0":"00"),o=Math.pow(r,1/3),e=Te((e+1)/3)-(e%3==(0>e?-1:2)),o==1/0?r="5e"+e:(r=o.toExponential(),r=r.slice(0,r.indexOf("e")+1)+e),n=new h(r),n.s=p.s),s=(e=h.precision)+3;;)if(u=n,c=u.times(u).times(u),l=c.plus(p),n=je(l.plus(p).times(u),l.plus(c),s+2,1),a(u.d).slice(0,s)===(r=a(n.d)).slice(0,s)){if(r=r.slice(s-3,s+1),"9999"!=r&&(i||"4999"!=r)){+r&&(+r.slice(1)||"5"!=r.charAt(0))||(f(n,e+1,1),t=!n.times(n).times(n).eq(p));break}if(!i&&(f(u,e+1,0),u.times(u).times(u).eq(p))){n=u;break}s+=4,i=1}return Me=!0,f(n,e,h.rounding,t)},Le.decimalPlaces=Le.dp=function(){var e,t=this.d,r=NaN;if(t){if(e=t.length-1,r=(e-Te(this.e/Re))*Re,e=t[e])for(;e%10==0;e/=10)r--;0>r&&(r=0)}return r},Le.dividedBy=Le.div=function(e){return je(this,new this.constructor(e))},Le.dividedToIntegerBy=Le.divToInt=function(e){var t=this,r=t.constructor;return f(je(t,new r(e),0,1,1),r.precision,r.rounding)},Le.equals=Le.eq=function(e){return 0===this.cmp(e)},Le.floor=function(){return f(new this.constructor(this),this.e+1,3)},Le.greaterThan=Le.gt=function(e){return this.cmp(e)>0},Le.greaterThanOrEqualTo=Le.gte=function(e){var t=this.cmp(e);return 1==t||0===t},Le.hyperbolicCosine=Le.cosh=function(){var e,t,r,n,i,a=this,o=a.constructor,s=new o(1);if(!a.isFinite())return new o(a.s?1/0:NaN);if(a.isZero())return s;r=o.precision,n=o.rounding,o.precision=r+Math.max(a.e,a.sd())+4,o.rounding=1,i=a.d.length,32>i?(e=Math.ceil(i/3),t=Math.pow(4,-e).toString()):(e=16,t="2.3283064365386962890625e-10"),a=_(o,1,a.times(t),new o(1),!0);for(var u,c=e,l=new o(8);c--;)u=a.times(a),a=s.minus(u.times(l.minus(u.times(l))));return f(a,o.precision=r,o.rounding=n,!0)},Le.hyperbolicSine=Le.sinh=function(){var e,t,r,n,i=this,a=i.constructor;if(!i.isFinite()||i.isZero())return new a(i);if(t=a.precision,r=a.rounding,a.precision=t+Math.max(i.e,i.sd())+4,a.rounding=1,n=i.d.length,3>n)i=_(a,2,i,i,!0);else{e=1.4*Math.sqrt(n),e=e>16?16:0|e,i=i.times(Math.pow(5,-e)),i=_(a,2,i,i,!0);for(var o,s=new a(5),u=new a(16),c=new a(20);e--;)o=i.times(i),i=i.times(s.plus(o.times(u.times(o).plus(c))))}return a.precision=t,a.rounding=r,f(i,t,r,!0)},Le.hyperbolicTangent=Le.tanh=function(){var e,t,r=this,n=r.constructor;return r.isFinite()?r.isZero()?new n(r):(e=n.precision,t=n.rounding,n.precision=e+7,n.rounding=1,je(r.sinh(),r.cosh(),n.precision=e,n.rounding=t)):new n(r.s)},Le.inverseCosine=Le.acos=function(){var e,t=this,r=t.constructor,n=t.abs().cmp(1),i=r.precision,a=r.rounding;return-1!==n?0===n?t.isNeg()?m(r,i,a):new r(0):new r(NaN):t.isZero()?m(r,i+4,a).times(.5):(r.precision=i+6,r.rounding=1,t=t.asin(),e=m(r,i+4,a).times(.5),r.precision=i,r.rounding=a,e.minus(t))},Le.inverseHyperbolicCosine=Le.acosh=function(){var e,t,r=this,n=r.constructor;return r.lte(1)?new n(r.eq(1)?0:NaN):r.isFinite()?(e=n.precision,t=n.rounding,n.precision=e+Math.max(Math.abs(r.e),r.sd())+4,n.rounding=1,Me=!1,r=r.times(r).minus(1).sqrt().plus(r),Me=!0,n.precision=e,n.rounding=t,r.ln()):new n(r)},Le.inverseHyperbolicSine=Le.asinh=function(){var e,t,r=this,n=r.constructor;return!r.isFinite()||r.isZero()?new n(r):(e=n.precision,t=n.rounding,n.precision=e+2*Math.max(Math.abs(r.e),r.sd())+6,n.rounding=1,Me=!1,r=r.times(r).plus(1).sqrt().plus(r),Me=!0,n.precision=e,n.rounding=t,r.ln())},Le.inverseHyperbolicTangent=Le.atanh=function(){var e,t,r,n,i=this,a=i.constructor;return i.isFinite()?i.e>=0?new a(i.abs().eq(1)?i.s/0:i.isZero()?i:NaN):(e=a.precision,t=a.rounding,n=i.sd(),Math.max(n,e)<2*-i.e-1?f(new a(i),e,t,!0):(a.precision=r=n-i.e,i=je(i.plus(1),new a(1).minus(i),r+e,1),a.precision=e+4,a.rounding=1,i=i.ln(),a.precision=e,a.rounding=t,i.times(.5))):new a(NaN)},Le.inverseSine=Le.asin=function(){var e,t,r,n,i=this,a=i.constructor;return i.isZero()?new a(i):(t=i.abs().cmp(1),r=a.precision,n=a.rounding,-1!==t?0===t?(e=m(a,r+4,n).times(.5),e.s=i.s,e):new a(NaN):(a.precision=r+6,a.rounding=1,i=i.div(new a(1).minus(i.times(i)).sqrt().plus(1)).atan(),a.precision=r,a.rounding=n,i.times(2)))},Le.inverseTangent=Le.atan=function(){var e,t,r,n,i,a,o,s,u,c=this,l=c.constructor,p=l.precision,h=l.rounding;if(c.isFinite()){if(c.isZero())return new l(c);if(c.abs().eq(1)&&qe>=p+4)return o=m(l,p+4,h).times(.25),o.s=c.s,o}else{if(!c.s)return new l(NaN);if(qe>=p+4)return o=m(l,p+4,h).times(.5),o.s=c.s,o}for(l.precision=s=p+10,l.rounding=1,r=Math.min(28,s/Re+2|0),e=r;e;--e)c=c.div(c.times(c).plus(1).sqrt().plus(1));for(Me=!1,t=Math.ceil(s/Re),n=1,u=c.times(c),o=new l(c),i=c;-1!==e;)if(i=i.times(u),a=o.minus(i.div(n+=2)),i=i.times(u),o=a.plus(i.div(n+=2)),void 0!==o.d[t])for(e=t;o.d[e]===a.d[e]&&e--;);return r&&(o=o.times(2<<r-1)),Me=!0,f(o,l.precision=p,l.rounding=h,!0)},Le.isFinite=function(){return!!this.d},Le.isInteger=Le.isInt=function(){return!!this.d&&Te(this.e/Re)>this.d.length-2},Le.isNaN=function(){return!this.s},Le.isNegative=Le.isNeg=function(){return this.s<0},Le.isPositive=Le.isPos=function(){return this.s>0},Le.isZero=function(){return!!this.d&&0===this.d[0]},Le.lessThan=Le.lt=function(e){return this.cmp(e)<0},Le.lessThanOrEqualTo=Le.lte=function(e){return this.cmp(e)<1},Le.logarithm=Le.log=function(e){var t,r,n,i,o,u,c,l,p=this,m=p.constructor,d=m.precision,g=m.rounding,v=5;if(null==e)e=new m(10),t=!0;else{if(e=new m(e),r=e.d,e.s<0||!r||!r[0]||e.eq(1))return new m(NaN);t=e.eq(10)}if(r=p.d,p.s<0||!r||!r[0]||p.eq(1))return new m(r&&!r[0]?-1/0:1!=p.s?NaN:r?0:1/0);if(t)if(r.length>1)o=!0;else{for(i=r[0];i%10===0;)i/=10;o=1!==i}if(Me=!1,c=d+v,u=w(p,c),n=t?h(m,c+10):w(e,c),l=je(u,n,c,1),s(l.d,i=d,g))do if(c+=10,u=w(p,c),n=t?h(m,c+10):w(e,c),l=je(u,n,c,1),!o){+a(l.d).slice(i+1,i+15)+1==1e14&&(l=f(l,d+1,0));break}while(s(l.d,i+=10,g));return Me=!0,f(l,d,g)},Le.minus=Le.sub=function(e){var t,r,n,i,a,o,s,u,c,l,h,m,d=this,g=d.constructor;if(e=new g(e),!d.d||!e.d)return d.s&&e.s?d.d?e.s=-e.s:e=new g(e.d||d.s!==e.s?d:NaN):e=new g(NaN),e;if(d.s!=e.s)return e.s=-e.s,d.plus(e);if(c=d.d,m=e.d,s=g.precision,u=g.rounding,!c[0]||!m[0]){if(m[0])e.s=-e.s;else{if(!c[0])return new g(3===u?-0:0);e=new g(d)}return Me?f(e,s,u):e}if(r=Te(e.e/Re),l=Te(d.e/Re),c=c.slice(),a=l-r){for(h=0>a,h?(t=c,a=-a,o=m.length):(t=m,r=l,o=c.length),n=Math.max(Math.ceil(s/Re),o)+2,a>n&&(a=n,t.length=1),t.reverse(),n=a;n--;)t.push(0);t.reverse()}else{for(n=c.length,o=m.length,h=o>n,h&&(o=n),n=0;o>n;n++)if(c[n]!=m[n]){h=c[n]<m[n];break}a=0}for(h&&(t=c,c=m,m=t,e.s=-e.s),o=c.length,n=m.length-o;n>0;--n)c[o++]=0;for(n=m.length;n>a;){if(c[--n]<m[n]){for(i=n;i&&0===c[--i];)c[i]=Ie-1;--c[i],c[n]+=Ie}c[n]-=m[n]}for(;0===c[--o];)c.pop();for(;0===c[0];c.shift())--r;return c[0]?(e.d=c,e.e=p(c,r),Me?f(e,s,u):e):new g(3===u?-0:0)},Le.modulo=Le.mod=function(e){var t,r=this,n=r.constructor;return e=new n(e),!r.d||!e.s||e.d&&!e.d[0]?new n(NaN):!e.d||r.d&&!r.d[0]?f(new n(r),n.precision,n.rounding):(Me=!1,9==n.modulo?(t=je(r,e.abs(),0,3,1),t.s*=e.s):t=je(r,e,0,n.modulo,1),t=t.times(e),Me=!0,r.minus(t))},Le.naturalExponential=Le.exp=function(){return b(this)},Le.naturalLogarithm=Le.ln=function(){return w(this)},Le.negated=Le.neg=function(){var e=new this.constructor(this);return e.s=-e.s,f(e)},Le.plus=Le.add=function(e){var t,r,n,i,a,o,s,u,c,l,h=this,m=h.constructor;if(e=new m(e),!h.d||!e.d)return h.s&&e.s?h.d||(e=new m(e.d||h.s===e.s?h:NaN)):e=new m(NaN),e;if(h.s!=e.s)return e.s=-e.s,h.minus(e);if(c=h.d,l=e.d,s=m.precision,u=m.rounding,!c[0]||!l[0])return l[0]||(e=new m(h)),Me?f(e,s,u):e;if(a=Te(h.e/Re),n=Te(e.e/Re),c=c.slice(),i=a-n){for(0>i?(r=c,i=-i,o=l.length):(r=l,n=a,o=c.length),a=Math.ceil(s/Re),o=a>o?a+1:o+1,i>o&&(i=o,r.length=1),r.reverse();i--;)r.push(0);r.reverse()}for(o=c.length,i=l.length,0>o-i&&(i=o,r=l,l=c,c=r),t=0;i;)t=(c[--i]=c[i]+l[i]+t)/Ie|0,c[i]%=Ie;for(t&&(c.unshift(t),++n),o=c.length;0==c[--o];)c.pop();return e.d=c,e.e=p(c,n),Me?f(e,s,u):e},Le.precision=Le.sd=function(e){var t,r=this;if(void 0!==e&&e!==!!e&&1!==e&&0!==e)throw Error(_e+e);return r.d?(t=d(r.d),e&&r.e+1>t&&(t=r.e+1)):t=NaN,t},Le.round=function(){var e=this,t=e.constructor;return f(new t(e),e.e+1,t.rounding)},Le.sine=Le.sin=function(){var e,t,r=this,n=r.constructor;return r.isFinite()?r.isZero()?new n(r):(e=n.precision,t=n.rounding,n.precision=e+Math.max(r.e,r.sd())+Re,n.rounding=1,r=A(n,O(n,r)),n.precision=e,n.rounding=t,f(ge>2?r.neg():r,e,t,!0)):new n(NaN)},Le.squareRoot=Le.sqrt=function(){var e,t,r,n,i,o,s=this,u=s.d,c=s.e,l=s.s,p=s.constructor;if(1!==l||!u||!u[0])return new p(!l||0>l&&(!u||u[0])?NaN:u?s:1/0);for(Me=!1,l=Math.sqrt(+s),0==l||l==1/0?(t=a(u),(t.length+c)%2==0&&(t+="0"),l=Math.sqrt(t),c=Te((c+1)/2)-(0>c||c%2),l==1/0?t="1e"+c:(t=l.toExponential(),t=t.slice(0,t.indexOf("e")+1)+c),n=new p(t)):n=new p(l.toString()),r=(c=p.precision)+3;;)if(o=n,n=o.plus(je(s,o,r+2,1)).times(.5),a(o.d).slice(0,r)===(t=a(n.d)).slice(0,r)){if(t=t.slice(r-3,r+1),"9999"!=t&&(i||"4999"!=t)){+t&&(+t.slice(1)||"5"!=t.charAt(0))||(f(n,c+1,1),e=!n.times(n).eq(s));break}if(!i&&(f(o,c+1,0),o.times(o).eq(s))){n=o;break}r+=4,i=1}return Me=!0,f(n,c,p.rounding,e)},Le.tangent=Le.tan=function(){var e,t,r=this,n=r.constructor;return r.isFinite()?r.isZero()?new n(r):(e=n.precision,t=n.rounding,n.precision=e+10,n.rounding=1,r=r.sin(),r.s=1,r=je(r,new n(1).minus(r.times(r)).sqrt(),e+10,0),n.precision=e,n.rounding=t,f(2==ge||4==ge?r.neg():r,e,t,!0)):new n(NaN)},Le.times=Le.mul=function(e){var t,r,n,i,a,o,s,u,c,l=this,h=l.constructor,m=l.d,d=(e=new h(e)).d;if(e.s*=l.s,!(m&&m[0]&&d&&d[0]))return new h(!e.s||m&&!m[0]&&!d||d&&!d[0]&&!m?NaN:m&&d?0*e.s:e.s/0);for(r=Te(l.e/Re)+Te(e.e/Re),u=m.length,c=d.length,c>u&&(a=m,m=d,d=a,o=u,u=c,c=o),a=[],o=u+c,n=o;n--;)a.push(0);for(n=c;--n>=0;){for(t=0,i=u+n;i>n;)s=a[i]+d[n]*m[i-n-1]+t,a[i--]=s%Ie|0,t=s/Ie|0;a[i]=(a[i]+t)%Ie|0}for(;!a[--o];)a.pop();for(t?++r:a.shift(),n=a.length;!a[--n];)a.pop();return e.d=a,e.e=p(a,r),Me?f(e,h.precision,h.rounding):e},Le.toBinary=function(e,t){return T(this,2,e,t)},Le.toDecimalPlaces=Le.toDP=function(e,t){var r=this,n=r.constructor;return r=new n(r),void 0===e?r:(o(e,0,ye),void 0===t?t=n.rounding:o(t,0,8),f(r,e+r.e+1,t))},Le.toExponential=function(e,t){var r,n=this,i=n.constructor;return void 0===e?r=l(n,!0):(o(e,0,ye),void 0===t?t=i.rounding:o(t,0,8),n=f(new i(n),e+1,t),r=l(n,!0,e+1)),n.isNeg()&&!n.isZero()?"-"+r:r},Le.toFixed=function(e,t){var r,n,i=this,a=i.constructor;return void 0===e?r=l(i):(o(e,0,ye),void 0===t?t=a.rounding:o(t,0,8),n=f(new a(i),e+i.e+1,t),r=l(n,!1,e+n.e+1)),i.isNeg()&&!i.isZero()?"-"+r:r},Le.toFraction=function(e){var t,r,n,i,o,s,u,c,f,l,p,h,m=this,g=m.d,v=m.constructor;if(!g)return new v(m);if(f=r=new v(1),n=c=new v(0),t=new v(n),o=t.e=d(g)-m.e-1,s=o%Re,t.d[0]=Ce(10,0>s?Re+s:s),null==e)e=o>0?t:f;else{if(u=new v(e),!u.isInt()||u.lt(f))throw Error(_e+u);e=u.gt(t)?o>0?t:f:u}for(Me=!1,u=new v(a(g)),l=v.precision,v.precision=o=g.length*Re*2;p=je(u,t,0,1,1),i=r.plus(p.times(n)),1!=i.cmp(e);)r=n,n=i,i=f,f=c.plus(p.times(i)),c=i,i=t,t=u.minus(p.times(i)),u=i;return i=je(e.minus(r),n,0,1,1),c=c.plus(i.times(f)),r=r.plus(i.times(n)),c.s=f.s=m.s,h=je(f,n,o,1).minus(m).abs().cmp(je(c,r,o,1).minus(m).abs())<1?[f,n]:[c,r],v.precision=l,Me=!0,h},Le.toHexadecimal=Le.toHex=function(e,t){return T(this,16,e,t)},Le.toJSON=function(){var e,t,r,n,i,o,s,c,f=this,l=f.s<0;if(!f.d)return xe.charAt(f.s?l?82:83:84);if(t=f.e,1===f.d.length&&4>t&&t>=0&&(o=f.d[0],2857>o))return 41>o?xe.charAt(l?o+41:o):(o-=41,l&&(o+=2816),n=o/88|0,xe.charAt(n)+xe.charAt(o-88*n));if(c=a(f.d),s="",!l&&8>=t&&t>=-7)n=64+t+7;else if(l&&4>=t&&t>=-3)n=80+t+3;else if(c.length===t+1)n=32*l;else if(n=32*l+16*(0>t),t=Math.abs(t),88>t)n+=1,s=xe.charAt(t);else if(7744>t)n+=2,o=t/88|0,s=xe.charAt(o)+xe.charAt(t-88*o);else for(e=u(String(t),10,88),i=e.length,n+=i,r=0;i>r;r++)s+=xe.charAt(e[r]);for(s=xe.charAt(n)+s,e=u(c,10,88),i=e.length,r=0;i>r;r++)s+=xe.charAt(e[r]);return s},Le.toNearest=function(e,t){var r=this,n=r.constructor;if(r=new n(r),null==e){if(!r.d)return r;e=new n(1),t=n.rounding}else{if(e=new n(e),void 0!==t&&o(t,0,8),!r.d)return e.s?r:e;if(!e.d)return e.s&&(e.s=r.s),e}return e.d[0]?(Me=!1,4>t&&(t=[4,5,7,8][t]),r=je(r,e,0,t,1).times(e),Me=!0,f(r)):(e.s=r.s,r=e),r},Le.toNumber=function(){return+this},Le.toOctal=function(e,t){return T(this,8,e,t)},Le.toPower=Le.pow=function(e){var t,r,n,i,o,u,c,l=this,p=l.constructor,h=+(e=new p(e));if(!(l.d&&e.d&&l.d[0]&&e.d[0]))return new p(Ce(+l,h));if(l=new p(l),l.eq(1))return l;if(n=p.precision,o=p.rounding,e.eq(1))return f(l,n,o);if(t=Te(e.e/Re),r=e.d.length-1,c=t>=r,u=l.s,c){if((r=0>h?-h:h)<=Pe)return i=v(p,l,r,n),e.s<0?new p(1).div(i):f(i,n,o)}else if(0>u)return new p(NaN);return u=0>u&&1&e.d[Math.max(t,r)]?-1:1,r=Ce(+l,h),t=0!=r&&isFinite(r)?new p(r+"").e:Te(h*(Math.log("0."+a(l.d))/Math.LN10+l.e+1)),t>p.maxE+1||t<p.minE-1?new p(t>0?u/0:0):(Me=!1,p.rounding=l.s=1,r=Math.min(12,(t+"").length),i=b(e.times(w(l,n+r)),n),i=f(i,n+5,1),s(i.d,n,o)&&(t=n+10,i=f(b(e.times(w(l,t+r)),t),t+5,1),+a(i.d).slice(n+1,n+15)+1==1e14&&(i=f(i,n+1,0))),i.s=u,Me=!0,p.rounding=o,f(i,n,o))},Le.toPrecision=function(e,t){var r,n=this,i=n.constructor;return void 0===e?r=l(n,n.e<=i.toExpNeg||n.e>=i.toExpPos):(o(e,1,ye),void 0===t?t=i.rounding:o(t,0,8),n=f(new i(n),e,t),r=l(n,e<=n.e||n.e<=i.toExpNeg,e)),n.isNeg()&&!n.isZero()?"-"+r:r},Le.toSignificantDigits=Le.toSD=function(e,t){var r=this,n=r.constructor;return void 0===e?(e=n.precision,t=n.rounding):(o(e,1,ye),void 0===t?t=n.rounding:o(t,0,8)),f(new n(r),e,t)},Le.toString=function(){var e=this,t=e.constructor,r=l(e,e.e<=t.toExpNeg||e.e>=t.toExpPos);return e.isNeg()&&!e.isZero()?"-"+r:r},Le.truncated=Le.trunc=function(){return f(new this.constructor(this),this.e+1,1)},Le.valueOf=function(){var e=this,t=e.constructor,r=l(e,e.e<=t.toExpNeg||e.e>=t.toExpPos);return e.isNeg()?"-"+r:r};var je=function(){function e(e,t,r){var n,i=0,a=e.length;for(e=e.slice();a--;)n=e[a]*t+i,e[a]=n%r|0,i=n/r|0;return i&&e.unshift(i),e}function t(e,t,r,n){var i,a;if(r!=n)a=r>n?1:-1;else for(i=a=0;r>i;i++)if(e[i]!=t[i]){a=e[i]>t[i]?1:-1;break}return a}function r(e,t,r,n){for(var i=0;r--;)e[r]-=i,i=e[r]<t[r]?1:0,e[r]=i*n+e[r]-t[r];for(;!e[0]&&e.length>1;)e.shift()}return function(n,i,a,o,s,u){var c,l,p,h,m,d,g,v,y,x,b,w,N,E,M,A,_,O,T,C,S=n.constructor,z=n.s==i.s?1:-1,B=n.d,k=i.d;if(!(B&&B[0]&&k&&k[0]))return new S(n.s&&i.s&&(B?!k||B[0]!=k[0]:k)?B&&0==B[0]||!k?0*z:z/0:NaN);for(u?(m=1,l=n.e-i.e):(u=Ie,m=Re,l=Te(n.e/m)-Te(i.e/m)),T=k.length,_=B.length,y=new S(z),x=y.d=[],p=0;k[p]==(B[p]||0);p++);if(k[p]>(B[p]||0)&&l--,null==a?(E=a=S.precision,o=S.rounding):E=s?a+(n.e-i.e)+1:a,0>E)x.push(1),d=!0;else{if(E=E/m+2|0,p=0,1==T){for(h=0,k=k[0],E++;(_>p||h)&&E--;p++)M=h*u+(B[p]||0),x[p]=M/k|0,h=M%k|0;d=h||_>p}else{for(h=u/(k[0]+1)|0,h>1&&(k=e(k,h,u),B=e(B,h,u),T=k.length,_=B.length),A=T,b=B.slice(0,T),w=b.length;T>w;)b[w++]=0;C=k.slice(),C.unshift(0),O=k[0],k[1]>=u/2&&++O;do h=0,c=t(k,b,T,w),0>c?(N=b[0],T!=w&&(N=N*u+(b[1]||0)),h=N/O|0,h>1?(h>=u&&(h=u-1),g=e(k,h,u),v=g.length,w=b.length,c=t(g,b,v,w),1==c&&(h--,r(g,v>T?C:k,v,u))):(0==h&&(c=h=1),g=k.slice()),v=g.length,w>v&&g.unshift(0),r(b,g,w,u),-1==c&&(w=b.length,c=t(k,b,T,w),1>c&&(h++,r(b,w>T?C:k,w,u))),w=b.length):0===c&&(h++,b=[0]),x[p++]=h,c&&b[0]?b[w++]=B[A]||0:(b=[B[A]],w=1);while((A++<_||void 0!==b[0])&&E--);d=void 0!==b[0]}x[0]||x.shift()}if(1==m)y.e=l,de=d;else{for(p=1,h=x[0];h>=10;h/=10)p++;y.e=p+l*m-1,f(y,s?a+y.e+1:a,o,d)}return y}}();Ne=G(Ne),be=new Ne(be),we=new Ne(we),n=function(){return Ne}.call(t,r,t,e),!(void 0!==n&&(e.exports=n))}(this)},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("bignumber",{"":function(){return new e.BigNumber(0)},number:function(t){return new e.BigNumber(t+"")},string:function(t){return new e.BigNumber(t)},BigNumber:function(e){return e},Fraction:function(t){return new e.BigNumber(t.n).div(t.d)},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={0:"0",1:"\\left(${args[0]}\\right)"},a}var i=r(19);t.name="bignumber",t.factory=n},function(e,t){"use strict";e.exports=function r(e,t,n){return e&&"function"==typeof e.map?e.map(function(e){return r(e,t,n)}):t(e)}},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("bool",{"":function(){return!1},"boolean":function(e){return e},number:function(e){return!!e},BigNumber:function(e){return!e.isZero()},string:function(e){var t=e.toLowerCase();if("true"===t)return!0;if("false"===t)return!1;var r=Number(e);if(""!=e&&!isNaN(r))return!!r;throw new Error('Cannot convert "'+e+'" to a boolean')},"Array | Matrix":function(e){return i(e,a)}});return a}var i=r(19);t.name="boolean",t.factory=n},function(e,t,r){e.exports=[r(22),r(25)]},function(e,t,r){"use strict";function n(e,t,r,n,o){function s(e){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");e&&e.isChain?this.value=e.value:this.value=e}function u(e,t){"function"==typeof t&&(s.prototype[e]=f(t))}function c(e,t){a(s.prototype,e,function(){var e=t();return"function"==typeof e?f(e):void 0})}function f(e){return function(){for(var t=[this.value],r=0;r<arguments.length;r++)t[r+1]=arguments[r];return new s(e.apply(e,t))}}return s.prototype.type="Chain",s.prototype.isChain=!0,s.prototype.done=function(){return this.value},s.prototype.valueOf=function(){return this.value},s.prototype.toString=function(){return i(this.value)},s.createProxy=function(e,t){if("string"==typeof e)u(e,t);else for(var r in e)e.hasOwnProperty(r)&&u(r,e[r])},s.createProxy(o),o.on("import",function(e,t,r){void 0===r&&c(e,t)}),s}var i=r(23).format,a=r(3).lazy;t.name="Chain",t.path="type",t.factory=n,t.math=!0,t.lazy=!1},function(e,t,r){"use strict";function n(e,r){if(Array.isArray(e)){for(var i="[",a=e.length,o=0;a>o;o++)0!=o&&(i+=", "),i+=n(e[o],r);return i+="]"}return t.format(e,r)}var i=r(6).format,a=r(24).format;t.isString=function(e){return"string"==typeof e},t.endsWith=function(e,t){var r=e.length-t.length,n=e.length;return e.substring(r,n)===t},t.format=function(e,r){if("number"==typeof e)return i(e,r);if(e&&e.isBigNumber===!0)return a(e,r);if(e&&e.isFraction===!0)return r&&"decimal"===r.fraction?e.toString():e.s*e.n+"/"+e.d;if(Array.isArray(e))return n(e,r);if(t.isString(e))return'"'+e+'"';if("function"==typeof e)return e.syntax?String(e.syntax):"function";if(e&&"object"==typeof e){if("function"==typeof e.format)return e.format(r);if(e&&e.toString()!=={}.toString())return e.toString();var o=[];for(var s in e)e.hasOwnProperty(s)&&o.push('"'+s+'": '+t.format(e[s],r));return"{"+o.join(", ")+"}"}return String(e)}},function(e,t){t.format=function(e,r){if("function"==typeof r)return r(e);if(!e.isFinite())return e.isNaN()?"NaN":e.gt(0)?"Infinity":"-Infinity";var n="auto",i=void 0;switch(void 0!==r&&(r.notation&&(n=r.notation),"number"==typeof r?i=r:r.precision&&(i=r.precision)),n){case"fixed":return t.toFixed(e,i);case"exponential":return t.toExponential(e,i);case"auto":var a=.001,o=1e5;r&&r.exponential&&(void 0!==r.exponential.lower&&(a=r.exponential.lower),void 0!==r.exponential.upper&&(o=r.exponential.upper));({toExpNeg:e.constructor.toExpNeg,toExpPos:e.constructor.toExpPos});if(e.constructor.config({toExpNeg:Math.round(Math.log(a)/Math.LN10),toExpPos:Math.round(Math.log(o)/Math.LN10)}),e.isZero())return"0";var s,u=e.abs();return s=u.gte(a)&&u.lt(o)?e.toSignificantDigits(i).toFixed():t.toExponential(e,i),s.replace(/((\.\d*?)(0+))($|e)/,function(){var e=arguments[2],t=arguments[4];return"."!==e?e+t:t});default:throw new Error('Unknown notation "'+n+'". Choose "auto", "exponential", or "fixed".')}},t.toExponential=function(e,t){return void 0!==t?e.toExponential(t-1):e.toExponential()},t.toFixed=function(e,t){return e.toFixed(t||0)}},function(e,t){"use strict";function r(e,t,r,n){return n("chain",{"":function(){return new e.Chain},any:function(t){
return new e.Chain(t)}})}t.name="chain",t.factory=r},function(e,t,r){e.exports=[r(27),r(31)]},function(e,t,r){function n(e,t,r,n,s){return i.prototype.type="Complex",i.prototype.isComplex=!0,i.prototype.toJSON=function(){return{mathjs:"Complex",re:this.re,im:this.im}},i.prototype.toPolar=function(){return{r:this.abs(),phi:this.arg()}},i.prototype.format=function(e){var t="",r=this.im,n=this.re,i=a(this.re,e),s=a(this.im,e),u=o(e)?e:e?e.precision:null;if(null!==u){var c=Math.pow(10,-u);Math.abs(n/r)<c&&(n=0),Math.abs(r/n)<c&&(r=0)}return t=0==r?i:0==n?1==r?"i":-1==r?"-i":s+"i":r>0?1==r?i+" + i":i+" + "+s+"i":-1==r?i+" - i":i+" - "+s.substring(1)+"i"},i.fromPolar=function(e){switch(arguments.length){case 1:var t=arguments[0];if("object"==typeof t)return i(t);throw new TypeError("Input has to be an object with r and phi keys.");case 2:var r=arguments[0],n=arguments[1];if(o(r)){if(n&&n.isUnit&&n.hasBase("ANGLE")&&(n=n.toNumber("rad")),o(n))return new i({r:r,phi:n});throw new TypeError("Phi is not a number nor an angle unit.")}throw new TypeError("Radius r is not a number.");default:throw new SyntaxError("Wrong number of arguments in function fromPolar")}},i.prototype.valueOf=i.prototype.toString,i.fromJSON=function(e){return new i(e)},i.EPSILON=t.epsilon,s.on("config",function(e,t){e.epsilon!==t.epsilon&&(i.EPSILON=e.epsilon)}),i}var i=r(28),a=r(6).format,o=r(6).isNumber;t.name="Complex",t.path="type",t.factory=n,t.math=!0},function(e,t,r){var n,i;(function(e){/**
	 * @license Complex.js v2.0.1 11/02/2016
	 *
	 * Copyright (c) 2016, Robert Eisele (robert@xarg.org)
	 * Dual licensed under the MIT or GPL Version 2 licenses.
	 **/
!function(a){"use strict";function o(e,t){var r=Math.abs(e),n=Math.abs(t);return 0===e?Math.log(n):0===t?Math.log(r):3e3>r&&3e3>n?.5*Math.log(e*e+t*t):Math.log(e/Math.cos(Math.atan2(t,e)))}function s(e,t){return this instanceof s?(f(e,t),this.re=u.re,void(this.im=u.im)):new s(e,t)}var u={re:0,im:0};Math.cosh=Math.cosh||function(e){return.5*(Math.exp(e)+Math.exp(-e))},Math.sinh=Math.sinh||function(e){return.5*(Math.exp(e)-Math.exp(-e))};var c=function(){throw SyntaxError("Invalid Param")},f=function(e,t){if(void 0===e||null===e)u.re=u.im=0;else if(void 0!==t)u.re=e,u.im=t;else switch(typeof e){case"object":"im"in e&&"re"in e?(u.re=e.re,u.im=e.im):"abs"in e&&"arg"in e?(u.re=e.abs*Math.cos(e.arg),u.im=e.abs*Math.sin(e.arg)):"r"in e&&"phi"in e?(u.re=e.r*Math.cos(e.phi),u.im=e.r*Math.sin(e.phi)):c();break;case"string":u.im=u.re=0;var r=e.match(/\d+\.?\d*e[+-]?\d+|\d+\.?\d*|\.\d+|./g),n=1,i=0;null===r&&c();for(var a=0;a<r.length;a++){var o=r[a];" "===o||"	"===o||"\n"===o||("+"===o?n++:"-"===o?i++:"i"===o||"I"===o?(n+i===0&&c()," "===r[a+1]||isNaN(r[a+1])?u.im+=parseFloat((i%2?"-":"")+"1"):(u.im+=parseFloat((i%2?"-":"")+r[a+1]),a++),n=i=0):((n+i===0||isNaN(o))&&c(),"i"===r[a+1]||"I"===r[a+1]?(u.im+=parseFloat((i%2?"-":"")+o),a++):u.re+=parseFloat((i%2?"-":"")+o),n=i=0))}n+i>0&&c();break;case"number":u.im=0,u.re=e;break;default:c()}isNaN(u.re)||isNaN(u.im)};s.prototype={re:0,im:0,sign:function(){var e=this.abs();return new s(this.re/e,this.im/e)},add:function(e,t){return f(e,t),new s(this.re+u.re,this.im+u.im)},sub:function(e,t){return f(e,t),new s(this.re-u.re,this.im-u.im)},mul:function(e,t){return f(e,t),0===u.im&&0===this.im?new s(this.re*u.re,0):new s(this.re*u.re-this.im*u.im,this.re*u.im+this.im*u.re)},div:function(e,t){f(e,t),e=this.re,t=this.im;var r,n,i=u.re,a=u.im;return 0===i&&0===a?new s(0!==e?e/0:0,0!==t?t/0:0):0===a?new s(e/i,t/i):Math.abs(i)<Math.abs(a)?(n=i/a,r=i*n+a,new s((e*n+t)/r,(t*n-e)/r)):(n=a/i,r=a*n+i,new s((e+t*n)/r,(t-e*n)/r))},pow:function(e,t){if(f(e,t),e=this.re,t=this.im,0===e&&0===t)return new s(0,0);var r=Math.atan2(t,e),n=o(e,t);if(0===u.im){if(0===t&&e>=0)return new s(Math.pow(e,u.re),0);if(0===e)switch(u.re%4){case 0:return new s(Math.pow(t,u.re),0);case 1:return new s(0,Math.pow(t,u.re));case 2:return new s(-Math.pow(t,u.re),0);case 3:return new s(0,-Math.pow(t,u.re))}}return e=Math.exp(u.re*n-u.im*r),t=u.im*n+u.re*r,new s(e*Math.cos(t),e*Math.sin(t))},sqrt:function(){var e,t,r=this.re,n=this.im,i=this.abs();return r>=0&&0===n?new s(Math.sqrt(r),0):(e=r>=0?.5*Math.sqrt(2*(i+r)):Math.abs(n)/Math.sqrt(2*(i-r)),t=0>=r?.5*Math.sqrt(2*(i-r)):Math.abs(n)/Math.sqrt(2*(i+r)),new s(e,n>=0?t:-t))},exp:function(){var e=Math.exp(this.re);return 0===this.im,new s(e*Math.cos(this.im),e*Math.sin(this.im))},log:function(){var e=this.re,t=this.im;return new s(o(e,t),Math.atan2(t,e))},abs:function(){var e=Math.abs(this.re),t=Math.abs(this.im);return 3e3>e&&3e3>t?Math.sqrt(e*e+t*t):(t>e?(e=t,t=this.re/this.im):t=this.im/this.re,e*Math.sqrt(1+t*t))},arg:function(){return Math.atan2(this.im,this.re)},sin:function(){var e=this.re,t=this.im;return new s(Math.sin(e)*Math.cosh(t),Math.cos(e)*Math.sinh(t))},cos:function(){var e=this.re,t=this.im;return new s(Math.cos(e)*Math.cosh(t),-Math.sin(e)*Math.sinh(t))},tan:function(){var e=2*this.re,t=2*this.im,r=Math.cos(e)+Math.cosh(t);return new s(Math.sin(e)/r,Math.sinh(t)/r)},cot:function(){var e=2*this.re,t=2*this.im,r=Math.cos(e)-Math.cosh(t);return new s(-Math.sin(e)/r,Math.sinh(t)/r)},sec:function(){var e=this.re,t=this.im,r=.5*Math.cosh(2*t)+.5*Math.cos(2*e);return new s(Math.cos(e)*Math.cosh(t)/r,Math.sin(e)*Math.sinh(t)/r)},csc:function(){var e=this.re,t=this.im,r=.5*Math.cosh(2*t)-.5*Math.cos(2*e);return new s(Math.sin(e)*Math.cosh(t)/r,-Math.cos(e)*Math.sinh(t)/r)},asin:function(){var e=this.re,t=this.im,r=new s(t*t-e*e+1,-2*e*t).sqrt(),n=new s(r.re-t,r.im+e).log();return new s(n.im,-n.re)},acos:function(){var e=this.re,t=this.im,r=new s(t*t-e*e+1,-2*e*t).sqrt(),n=new s(r.re-t,r.im+e).log();return new s(Math.PI/2-n.im,n.re)},atan:function(){var e=this.re,t=this.im;if(0===e){if(1===t)return new s(0,1/0);if(-1===t)return new s(0,-(1/0))}var r=e*e+(1-t)*(1-t),n=new s((1-t*t-e*e)/r,-2*e/r).log();return new s(-.5*n.im,.5*n.re)},acot:function(){var e=this.re,t=this.im;if(0===t)return new s(Math.atan2(1,e),0);var r=e*e+t*t;return 0!==r?new s(e/r,-t/r).atan():new s(0!==e?e/0:0,0!==t?-t/0:0).atan()},asec:function(){var e=this.re,t=this.im;if(0===e&&0===t)return new s(0,1/0);var r=e*e+t*t;return 0!==r?new s(e/r,-t/r).acos():new s(0!==e?e/0:0,0!==t?-t/0:0).acos()},acsc:function(){var e=this.re,t=this.im;if(0===e&&0===t)return new s(Math.PI/2,1/0);var r=e*e+t*t;return 0!==r?new s(e/r,-t/r).asin():new s(0!==e?e/0:0,0!==t?-t/0:0).asin()},sinh:function(){var e=this.re,t=this.im;return new s(Math.sinh(e)*Math.cos(t),Math.cosh(e)*Math.sin(t))},cosh:function(){var e=this.re,t=this.im;return new s(Math.cosh(e)*Math.cos(t),Math.sinh(e)*Math.sin(t))},tanh:function(){var e=2*this.re,t=2*this.im,r=Math.cosh(e)+Math.cos(t);return new s(Math.sinh(e)/r,Math.sin(t)/r)},coth:function(){var e=2*this.re,t=2*this.im,r=Math.cosh(e)-Math.cos(t);return new s(Math.sinh(e)/r,-Math.sin(t)/r)},csch:function(){var e=this.re,t=this.im,r=Math.cos(2*t)-Math.cosh(2*e);return new s(-2*Math.sinh(e)*Math.cos(t)/r,2*Math.cosh(e)*Math.sin(t)/r)},sech:function(){var e=this.re,t=this.im,r=Math.cos(2*t)+Math.cosh(2*e);return new s(2*Math.cosh(e)*Math.cos(t)/r,-2*Math.sinh(e)*Math.sin(t)/r)},asinh:function(){var e=this.im;this.im=-this.re,this.re=e;var t=this.asin();return this.re=-this.im,this.im=e,e=t.re,t.re=-t.im,t.im=e,t},acosh:function(){var e,t=this.acos();return t.im<=0?(e=t.re,t.re=-t.im,t.im=e):(e=t.im,t.im=-t.re,t.re=e),t},atanh:function(){var e=this.re,t=this.im,r=e>1&&0===t,n=1-e,i=1+e,a=n*n+t*t,u=0!==a?new s((i*n-t*t)/a,(t*n+i*t)/a):new s(-1!==e?e/0:0,0!==t?t/0:0),c=u.re;return u.re=o(u.re,u.im)/2,u.im=Math.atan2(u.im,c)/2,r&&(u.im=-u.im),u},acoth:function(){var e=this.re,t=this.im;if(0===e&&0===t)return new s(0,Math.PI/2);var r=e*e+t*t;return 0!==r?new s(e/r,-t/r).atanh():new s(0!==e?e/0:0,0!==t?-t/0:0).atanh()},acsch:function(){var e=this.re,t=this.im;if(0===t)return new s(0!==e?Math.log(e+Math.sqrt(e*e+1)):1/0,0);var r=e*e+t*t;return 0!==r?new s(e/r,-t/r).asinh():new s(0!==e?e/0:0,0!==t?-t/0:0).asinh()},asech:function(){var e=this.re,t=this.im;if(0===e&&0===t)return new s(1/0,0);var r=e*e+t*t;return 0!==r?new s(e/r,-t/r).acosh():new s(0!==e?e/0:0,0!==t?-t/0:0).acosh()},inverse:function(){var e=this.re,t=this.im,r=e*e+t*t;return new s(0!==e?e/r:0,0!==t?-t/r:0)},conjugate:function(){return new s(this.re,-this.im)},neg:function(){return new s(-this.re,-this.im)},ceil:function(e){return e=Math.pow(10,e||0),new s(Math.ceil(this.re*e)/e,Math.ceil(this.im*e)/e)},floor:function(e){return e=Math.pow(10,e||0),new s(Math.floor(this.re*e)/e,Math.floor(this.im*e)/e)},round:function(e){return e=Math.pow(10,e||0),new s(Math.round(this.re*e)/e,Math.round(this.im*e)/e)},equals:function(e,t){return f(e,t),Math.abs(u.re-this.re)<=s.EPSILON&&Math.abs(u.im-this.im)<=s.EPSILON},clone:function(){return new s(this.re,this.im)},toString:function(){var e=this.re,t=this.im,r="";return isNaN(e)||isNaN(t)?"NaN":(0!==e&&(r+=e),0!==t&&(0!==e?r+=0>t?" - ":" + ":0>t&&(r+="-"),t=Math.abs(t),1!==t&&(r+=t),r+="i"),r?r:"0")},toVector:function(){return[this.re,this.im]},valueOf:function(){return 0===this.im?this.re:null},isNaN:function(){return isNaN(this.re)||isNaN(this.im)}},s.ZERO=new s(0,0),s.ONE=new s(1,0),s.I=new s(0,1),s.PI=new s(Math.PI,0),s.E=new s(Math.E,0),s.EPSILON=1e-16,r(30).amd?(n=[],i=function(){return s}.apply(t,n),!(void 0!==i&&(e.exports=i))):e.exports=s}(this)}).call(t,r(29)(e))},function(e,t){e.exports=function(e){return e.webpackPolyfill||(e.deprecate=function(){},e.paths=[],e.children=[],e.webpackPolyfill=1),e}},function(e,t){e.exports=function(){throw new Error("define cannot be used indirect")}},function(e,t,r){"use strict";function n(e,t,n,a){var o=r(32),s=a("complex",{"":function(){return e.Complex.ZERO},number:function(t){return new e.Complex(t,0)},"number, number":function(t,r){return new e.Complex(t,r)},"BigNumber, BigNumber":function(t,r){return new e.Complex(t.toNumber(),r.toNumber())},Complex:function(e){return e.clone()},string:function(t){return e.Complex(t)},Object:function(t){if("re"in t&&"im"in t)return new e.Complex(t.re,t.im);if("r"in t&&"phi"in t)return new e.Complex(t);throw new Error("Expected object with either properties re and im, or properties r and phi.")},"Array | Matrix":function(e){return i(e,s)}});return s.toTex={0:"0",1:"\\left(${args[0]}\\right)",2:"\\left(\\left(${args[0]}\\right)+"+o.symbols.i+"\\cdot\\left(${args[1]}\\right)\\right)"},s}var i=r(19);t.name="complex",t.factory=n},function(e,t){"use strict";t.symbols={Alpha:"A",alpha:"\\alpha",Beta:"B",beta:"\\beta",Gamma:"\\Gamma",gamma:"\\gamma",Delta:"\\Delta",delta:"\\delta",Epsilon:"E",epsilon:"\\epsilon",varepsilon:"\\varepsilon",Zeta:"Z",zeta:"\\zeta",Eta:"H",eta:"\\eta",Theta:"\\Theta",theta:"\\theta",vartheta:"\\vartheta",Iota:"I",iota:"\\iota",Kappa:"K",kappa:"\\kappa",varkappa:"\\varkappa",Lambda:"\\Lambda",lambda:"\\lambda",Mu:"M",mu:"\\mu",Nu:"N",nu:"\\nu",Xi:"\\Xi",xi:"\\xi",Omicron:"O",omicron:"o",Pi:"\\Pi",pi:"\\pi",varpi:"\\varpi",Rho:"P",rho:"\\rho",varrho:"\\varrho",Sigma:"\\Sigma",sigma:"\\sigma",varsigma:"\\varsigma",Tau:"T",tau:"\\tau",Upsilon:"\\Upsilon",upsilon:"\\upsilon",Phi:"\\Phi",phi:"\\phi",varphi:"\\varphi",Chi:"X",chi:"\\chi",Psi:"\\Psi",psi:"\\psi",Omega:"\\Omega",omega:"\\omega","true":"\\mathrm{True}","false":"\\mathrm{False}",i:"i",inf:"\\infty",Inf:"\\infty",infinity:"\\infty",Infinity:"\\infty",oo:"\\infty",lim:"\\lim",undefined:"\\mathbf{?}"},t.operators={transpose:"^\\top",factorial:"!",pow:"^",dotPow:".^\\wedge",unaryPlus:"+",unaryMinus:"-",bitNot:"~",not:"\\neg",multiply:"\\cdot",divide:"\\frac",dotMultiply:".\\cdot",dotDivide:".:",mod:"\\mod",add:"+",subtract:"-",to:"\\rightarrow",leftShift:"<<",rightArithShift:">>",rightLogShift:">>>",equal:"=",unequal:"\\neq",smaller:"<",larger:">",smallerEq:"\\leq",largerEq:"\\geq",bitAnd:"\\&",bitXor:"\\underline{|}",bitOr:"|",and:"\\wedge",xor:"\\veebar",or:"\\vee"},t.defaultTemplate="\\mathrm{${name}}\\left(${args}\\right)";var r={deg:"^\\circ"};t.toSymbol=function(e,n){if(n="undefined"==typeof n?!1:n)return r.hasOwnProperty(e)?r[e]:"\\mathrm{"+e+"}";if(t.symbols.hasOwnProperty(e))return t.symbols[e];if(-1!==e.indexOf("_")){var i=e.indexOf("_");return t.toSymbol(e.substring(0,i))+"_{"+t.toSymbol(e.substring(i+1))+"}"}return e}},function(e,t,r){e.exports=[r(34),r(36)]},function(e,t,r){function n(e,t,r,n){return i}var i=r(35);i.prototype.type="Fraction",i.prototype.isFraction=!0,i.prototype.toJSON=function(){return{mathjs:"Fraction",n:this.s*this.n,d:this.d}},i.fromJSON=function(e){return new i(e)},t.name="Fraction",t.path="type",t.factory=n},function(e,t,r){var n,i;(function(e){/**
	 * @license Fraction.js v3.3.1 09/09/2015
	 * http://www.xarg.org/2014/03/precise-calculations-in-javascript/
	 *
	 * Copyright (c) 2015, Robert Eisele (robert@xarg.org)
	 * Dual licensed under the MIT or GPL Version 2 licenses.
	 **/
!function(a){"use strict";function o(e,t){return isNaN(e=parseInt(e,10))&&s(),e*t}function s(){throw"Invalid Param"}function u(e,t){return this instanceof u?(l(e,t),e=u.REDUCE?d(f.d,f.n):1,this.s=f.s,this.n=f.n/e,void(this.d=f.d/e)):new u(e,t)}var c=2e3,f={s:1,n:0,d:1},l=function(e,t){var r,n=0,i=1,a=1,u=0,c=0,l=0,p=1,h=1,m=0,d=1,g=1,v=1,y=1e7;if(void 0===e||null===e);else if(void 0!==t)n=e,i=t,a=n*i;else switch(typeof e){case"object":"d"in e&&"n"in e?(n=e.n,i=e.d,"s"in e&&(n*=e.s)):0 in e?(n=e[0],1 in e&&(i=e[1])):s(),a=n*i;break;case"number":if(0>e&&(a=e,e=-e),e%1===0)n=e;else if(e>0){for(e>=1&&(h=Math.pow(10,Math.floor(1+Math.log(e)/Math.LN10)),e/=h);y>=d&&y>=v;){if(r=(m+g)/(d+v),e===r){y>=d+v?(n=m+g,i=d+v):v>d?(n=g,i=v):(n=m,i=d);break}e>r?(m+=g,d+=v):(g+=m,v+=d),d>y?(n=g,i=v):(n=m,i=d)}n*=h}else(isNaN(e)||isNaN(t))&&(i=n=NaN);break;case"string":if(d=e.match(/\d+|./g),"-"===d[m]?(a=-1,m++):"+"===d[m]&&m++,d.length===m+1?c=o(d[m++],a):"."===d[m+1]||"."===d[m]?("."!==d[m]&&(u=o(d[m++],a)),m++,(m+1===d.length||"("===d[m+1]&&")"===d[m+3]||"'"===d[m+1]&&"'"===d[m+3])&&(c=o(d[m],a),p=Math.pow(10,d[m].length),m++),("("===d[m]&&")"===d[m+2]||"'"===d[m]&&"'"===d[m+2])&&(l=o(d[m+1],a),h=Math.pow(10,d[m+1].length)-1,m+=3)):"/"===d[m+1]||":"===d[m+1]?(c=o(d[m],a),p=o(d[m+2],1),m+=3):"/"===d[m+3]&&" "===d[m+1]&&(u=o(d[m],a),c=o(d[m+2],a),p=o(d[m+4],1),m+=5),d.length<=m){i=p*h,a=n=l+i*u+h*c;break}default:s()}if(0===i)throw"DIV/0";f.s=0>a?-1:1,f.n=Math.abs(n),f.d=Math.abs(i)},p=function(e,t,r){for(var n=1;t>0;e=e*e%r,t>>=1)1&t&&(n=n*e%r);return n},h=function(e,t){for(;t%2===0;t/=2);for(;t%5===0;t/=5);if(1===t)return 0;for(var r=10%t,n=1;1!==r;n++)if(r=10*r%t,n>c)return 0;return n},m=function(e,t,r){for(var n=1,i=p(10,r,t),a=0;300>a;a++){if(n===i)return a;n=10*n%t,i=10*i%t}return 0},d=function(e,t){if(!e)return t;if(!t)return e;for(;;){if(e%=t,!e)return t;if(t%=e,!t)return e}};u.REDUCE=1,u.prototype={s:1,n:0,d:1,abs:function(){return new u(this.n,this.d)},neg:function(){return new u(-this.s*this.n,this.d)},add:function(e,t){return l(e,t),new u(this.s*this.n*f.d+f.s*this.d*f.n,this.d*f.d)},sub:function(e,t){return l(e,t),new u(this.s*this.n*f.d-f.s*this.d*f.n,this.d*f.d)},mul:function(e,t){return l(e,t),new u(this.s*f.s*this.n*f.n,this.d*f.d)},div:function(e,t){return l(e,t),new u(this.s*f.s*this.n*f.d,this.d*f.n)},clone:function(){return new u(this)},mod:function(e,t){return isNaN(this.n)||isNaN(this.d)?new u(NaN):void 0===e?new u(this.s*this.n%this.d,1):(l(e,t),0===f.n&&0===this.d&&u(0,0),new u(this.s*f.d*this.n%(f.n*this.d),f.d*this.d))},gcd:function(e,t){return l(e,t),new u(d(f.n,this.n),f.d*this.d/d(f.d,this.d))},lcm:function(e,t){return l(e,t),0===f.n&&0===this.n?new u:new u(f.n*this.n/d(f.n,this.n),d(f.d,this.d))},ceil:function(e){return e=Math.pow(10,e||0),isNaN(this.n)||isNaN(this.d)?new u(NaN):new u(Math.ceil(e*this.s*this.n/this.d),e)},floor:function(e){return e=Math.pow(10,e||0),isNaN(this.n)||isNaN(this.d)?new u(NaN):new u(Math.floor(e*this.s*this.n/this.d),e)},round:function(e){return e=Math.pow(10,e||0),isNaN(this.n)||isNaN(this.d)?new u(NaN):new u(Math.round(e*this.s*this.n/this.d),e)},inverse:function(){return new u(this.s*this.d,this.n)},pow:function(e){return 0>e?new u(Math.pow(this.s*this.d,-e),Math.pow(this.n,-e)):new u(Math.pow(this.s*this.n,e),Math.pow(this.d,e))},equals:function(e,t){return l(e,t),this.s*this.n*f.d===f.s*f.n*this.d},compare:function(e,t){l(e,t);var r=this.s*this.n*f.d-f.s*f.n*this.d;return(r>0)-(0>r)},divisible:function(e,t){return l(e,t),!(!(f.n*this.d)||this.n*f.d%(f.n*this.d))},valueOf:function(){return this.s*this.n/this.d},toFraction:function(e){var t,r="",n=this.n,i=this.d;return this.s<0&&(r+="-"),1===i?r+=n:(e&&(t=Math.floor(n/i))>0&&(r+=t,r+=" ",n%=i),r+=n,r+="/",r+=i),r},toLatex:function(e){var t,r="",n=this.n,i=this.d;return this.s<0&&(r+="-"),1===i?r+=n:(e&&(t=Math.floor(n/i))>0&&(r+=t,n%=i),r+="\\frac{",r+=n,r+="}{",r+=i,r+="}"),r},toContinued:function(){var e,t=this.n,r=this.d,n=[];do n.push(Math.floor(t/r)),e=t%r,t=r,r=e;while(1!==t);return n},toString:function(){var e,t=this.n,r=this.d;if(isNaN(t)||isNaN(r))return"NaN";u.REDUCE||(e=d(t,r),t/=e,r/=e);for(var n=String(t).split(""),i=0,a=[~this.s?"":"-","",""],o="",s=h(t,r),c=m(t,r,s),f=-1,l=1,p=15+s+c+n.length,g=0;p>g;g++,i*=10){if(g<n.length?i+=Number(n[g]):(l=2,f++),s>0)if(f===c)a[l]+=o+"(",o="";else if(f===s+c){a[l]+=o+")";break}i>=r?(a[l]+=o+(i/r|0),o="",i%=r):l>1?o+="0":a[l]&&(a[l]+="0")}return a[0]+=a[1]||"0",a[2]?a[0]+"."+a[2]:a[0]}},r(30).amd?(n=[],i=function(){return u}.apply(t,n),!(void 0!==i&&(e.exports=i))):e.exports=u}(this)}).call(t,r(29)(e))},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("fraction",{number:function(t){if(!isFinite(t)||isNaN(t))throw new Error(t+" cannot be represented as a fraction");return new e.Fraction(t)},string:function(t){return new e.Fraction(t)},"number, number":function(t,r){return new e.Fraction(t,r)},BigNumber:function(t){return new e.Fraction(t.toString())},Fraction:function(e){return e},Object:function(t){return new e.Fraction(t)},"Array | Matrix":function(e){return i(e,a)}});return a}var i=r(19);t.name="fraction",t.factory=n},function(e,t,r){e.exports=[r(38),r(46),r(47),r(50),r(59),r(65),r(66),r(67),r(68),r(52),r(69)]},function(e,t,r){"use strict";function n(e,t,r,n){function i(){if(!(this instanceof i))throw new SyntaxError("Constructor must be called with the new operator")}return i.prototype.type="Matrix",i.prototype.isMatrix=!0,i.storage=function(e){if(!o(e))throw new TypeError("format must be a string value");var t=i._storage[e];if(!t)throw new SyntaxError("Unsupported matrix storage format: "+e);return t},i._storage={},i.prototype.storage=function(){throw new Error("Cannot invoke storage on a Matrix interface")},i.prototype.datatype=function(){throw new Error("Cannot invoke datatype on a Matrix interface")},i.prototype.create=function(e,t){throw new Error("Cannot invoke create on a Matrix interface")},i.prototype.subset=function(e,t,r){throw new Error("Cannot invoke subset on a Matrix interface")},i.prototype.get=function(e){throw new Error("Cannot invoke get on a Matrix interface")},i.prototype.set=function(e,t,r){throw new Error("Cannot invoke set on a Matrix interface")},i.prototype.resize=function(e,t){throw new Error("Cannot invoke resize on a Matrix interface")},i.prototype.clone=function(){throw new Error("Cannot invoke clone on a Matrix interface")},i.prototype.size=function(){throw new Error("Cannot invoke size on a Matrix interface")},i.prototype.map=function(e,t){throw new Error("Cannot invoke map on a Matrix interface")},i.prototype.forEach=function(e){throw new Error("Cannot invoke forEach on a Matrix interface")},i.prototype.toArray=function(){throw new Error("Cannot invoke toArray on a Matrix interface")},i.prototype.valueOf=function(){throw new Error("Cannot invoke valueOf on a Matrix interface")},i.prototype.format=function(e){throw new Error("Cannot invoke format on a Matrix interface")},i.prototype.toString=function(){throw new Error("Cannot invoke toString on a Matrix interface")},i}var i=r(39),a=i.string,o=a.isString;t.name="Matrix",t.path="type",t.factory=n},function(e,t,r){"use strict";t.array=r(40),t["boolean"]=r(44),t["function"]=r(45),t.number=r(6),t.object=r(3),t.string=r(23),t.types=r(41),t.emitter=r(8)},function(e,t,r){"use strict";function n(e,t,r){var i,a=e.length;if(a!=t[r])throw new c(a,t[r]);if(r<t.length-1){var o=r+1;for(i=0;a>i;i++){var s=e[i];if(!Array.isArray(s))throw new c(t.length-1,t.length,"<");n(e[i],t,o)}}else for(i=0;a>i;i++)if(Array.isArray(e[i]))throw new c(t.length+1,t.length,">")}function i(e,r,n,a){var o,s,u=e.length,c=r[n],f=Math.min(u,c);if(e.length=c,n<r.length-1){var l=n+1;for(o=0;f>o;o++)s=e[o],Array.isArray(s)||(s=[s],e[o]=s),i(s,r,l,a);for(o=f;c>o;o++)s=[],e[o]=s,i(s,r,l,a)}else{for(o=0;f>o;o++)for(;Array.isArray(e[o]);)e[o]=e[o][0];if(a!==t.UNINITIALIZED)for(o=f;c>o;o++)e[o]=a}}function a(e,t,r){var n,i;if(t>r){var o=r+1;for(n=0,i=e.length;i>n;n++)e[n]=a(e[n],t,o)}else for(;Array.isArray(e);)e=e[0];return e}function o(e,t,r){var n,i;if(Array.isArray(e)){var a=r+1;for(n=0,i=e.length;i>n;n++)e[n]=o(e[n],t,a)}else for(var s=r;t>s;s++)e=[e];return e}var s=r(6),u=r(23),c=(r(3),r(41),r(42)),f=r(43);t.size=function(e){for(var t=[];Array.isArray(e);)t.push(e.length),e=e[0];return t},t.validate=function(e,t){var r=0==t.length;if(r){if(Array.isArray(e))throw new c(e.length,0)}else n(e,t,0)},t.validateIndex=function(e,t){if(!s.isNumber(e)||!s.isInteger(e))throw new TypeError("Index must be an integer (value: "+e+")");if(0>e||"number"==typeof t&&e>=t)throw new f(e,t)},t.UNINITIALIZED={},t.resize=function(e,t,r){if(!Array.isArray(e)||!Array.isArray(t))throw new TypeError("Array expected");if(0===t.length)throw new Error("Resizing to scalar is not supported");t.forEach(function(e){if(!s.isNumber(e)||!s.isInteger(e)||0>e)throw new TypeError("Invalid size, must contain positive integers (size: "+u.format(t)+")")});var n=void 0!==r?r:0;return i(e,t,0,n),e},t.squeeze=function(e,r){for(var n=r||t.size(e);Array.isArray(e)&&1===e.length;)e=e[0],n.shift();for(var i=n.length;1===n[i-1];)i--;return i<n.length&&(e=a(e,i,0),n.length=i),e},t.unsqueeze=function(e,r,n,i){var a=i||t.size(e);if(n)for(var s=0;n>s;s++)e=[e],a.unshift(1);for(e=o(e,r,0);a.length<r;)a.push(1);return e},t.flatten=function(e){if(!Array.isArray(e))return e;var t=[];return e.forEach(function r(e){Array.isArray(e)?e.forEach(r):t.push(e)}),t},t.isArray=Array.isArray},function(e,t){"use strict";t.type=function(e){var t=typeof e;return"object"===t?null===e?"null":e instanceof Boolean?"boolean":e instanceof Number?"number":e instanceof String?"string":Array.isArray(e)?"Array":e instanceof Date?"Date":e instanceof RegExp?"RegExp":"Object":"function"===t?"Function":t},t.isScalar=function(e){return!(e&&e.isMatrix||Array.isArray(e))}},function(e,t){"use strict";function r(e,t,n){if(!(this instanceof r))throw new SyntaxError("Constructor must be called with the new operator");this.actual=e,this.expected=t,this.relation=n,this.message="Dimension mismatch ("+(Array.isArray(e)?"["+e.join(", ")+"]":e)+" "+(this.relation||"!=")+" "+(Array.isArray(t)?"["+t.join(", ")+"]":t)+")",this.stack=(new Error).stack}r.prototype=new RangeError,r.prototype.constructor=RangeError,r.prototype.name="DimensionError",r.prototype.isDimensionError=!0,e.exports=r},function(e,t){"use strict";function r(e,t,n){if(!(this instanceof r))throw new SyntaxError("Constructor must be called with the new operator");this.index=e,arguments.length<3?(this.min=0,this.max=t):(this.min=t,this.max=n),void 0!==this.min&&this.index<this.min?this.message="Index out of range ("+this.index+" < "+this.min+")":void 0!==this.max&&this.index>=this.max?this.message="Index out of range ("+this.index+" > "+(this.max-1)+")":this.message="Index out of range ("+this.index+")",this.stack=(new Error).stack}r.prototype=new RangeError,r.prototype.constructor=RangeError,r.prototype.name="IndexError",r.prototype.isIndexError=!0,e.exports=r},function(e,t){"use strict";t.isBoolean=function(e){return"boolean"==typeof e}},function(e,t){t.memoize=function(e,t){return function r(){"object"!=typeof r.cache&&(r.cache={});for(var n=[],i=0;i<arguments.length;i++)n[i]=arguments[i];var a=t?t(n):JSON.stringify(n);return a in r.cache?r.cache[a]:r.cache[a]=e.apply(e,n)}}},function(e,t,r){"use strict";function n(e,t,n,c){function d(e,t){if(!(this instanceof d))throw new SyntaxError("Constructor must be called with the new operator");if(t&&!h(t))throw new Error("Invalid datatype: "+t);if(e&&e.isMatrix===!0)"DenseMatrix"===e.type?(this._data=u.clone(e._data),this._size=u.clone(e._size),this._datatype=t||e._datatype):(this._data=e.toArray(),this._size=e.size(),this._datatype=t||e._datatype);else if(e&&f(e.data)&&f(e.size))this._data=e.data,this._size=e.size,this._datatype=t||e.datatype;else if(f(e))this._data=w(e),this._size=s.size(this._data),s.validate(this._data,this._size),this._datatype=t;else{if(e)throw new TypeError("Unsupported type of data ("+i.types.type(e)+")");this._data=[],this._size=[0],this._datatype=t}}function g(e,t){if(!t||t.isIndex!==!0)throw new TypeError("Invalid index");var r=t.isScalar();if(r)return e.get(t.min());var n=t.size();if(n.length!=e._size.length)throw new a(n.length,e._size.length);for(var i=t.min(),o=t.max(),s=0,u=e._size.length;u>s;s++)m(i[s],e._size[s]),m(o[s],e._size[s]);return new d(v(e._data,t,n.length,0),e._datatype)}function v(e,t,r,n){var i=n==r-1,a=t.dimension(n);return i?a.map(function(t){return e[t]}).valueOf():a.map(function(i){var a=e[i];return v(a,t,r,n+1)}).valueOf()}function y(e,t,r,n){if(!t||t.isIndex!==!0)throw new TypeError("Invalid index");var i,o=t.size(),c=t.isScalar();if(r&&r.isMatrix===!0?(i=r.size(),r=r.valueOf()):i=s.size(r),c){if(0!==i.length)throw new TypeError("Scalar expected");e.set(t.min(),r,n)}else{if(o.length<e._size.length)throw new a(o.length,e._size.length,"<");if(i.length<o.length){for(var f=0,l=0;1===o[f]&&1===i[f];)f++;for(;1===o[f];)l++,f++;r=s.unsqueeze(r,o.length,l,i)}if(!u.deepEqual(o,i))throw new a(o,i,">");var p=t.max().map(function(e){return e+1});b(e,p,n);var h=o.length,m=0;x(e._data,t,r,h,m)}return e}function x(e,t,r,n,i){var a=i==n-1,o=t.dimension(i);a?o.forEach(function(t,n){m(t),e[t]=r[n[0]]}):o.forEach(function(a,o){m(a),x(e[a],t,r[o[0]],n,i+1)})}function b(e,t,r){for(var n=e._size.slice(0),i=!1;n.length<t.length;)n.push(0),i=!0;for(var a=0,o=t.length;o>a;a++)t[a]>n[a]&&(n[a]=t[a],i=!0);i&&E(e,n,r)}function w(e){for(var t=0,r=e.length;r>t;t++){var n=e[t];f(n)?e[t]=w(n):n&&n.isMatrix===!0&&(e[t]=w(n.valueOf()))}return e}var N=n(r(38));d.prototype=new N,d.prototype.type="DenseMatrix",d.prototype.isDenseMatrix=!0,d.prototype.storage=function(){return"dense"},d.prototype.datatype=function(){return this._datatype},d.prototype.create=function(e,t){return new d(e,t)},d.prototype.subset=function(e,t,r){switch(arguments.length){case 1:return g(this,e);case 2:case 3:return y(this,e,t,r);default:throw new SyntaxError("Wrong number of arguments")}},d.prototype.get=function(e){if(!f(e))throw new TypeError("Array expected");if(e.length!=this._size.length)throw new a(e.length,this._size.length);for(var t=0;t<e.length;t++)m(e[t],this._size[t]);for(var r=this._data,n=0,i=e.length;i>n;n++){var o=e[n];m(o,r.length),r=r[o]}return r},d.prototype.set=function(e,t,r){if(!f(e))throw new TypeError("Array expected");if(e.length<this._size.length)throw new a(e.length,this._size.length,"<");var n,i,o,s=e.map(function(e){return e+1});b(this,s,r);var u=this._data;for(n=0,i=e.length-1;i>n;n++)o=e[n],m(o,u.length),u=u[o];return o=e[e.length-1],m(o,u.length),u[o]=t,this},d.prototype.resize=function(e,t,r){if(!f(e))throw new TypeError("Array expected");var n=r?this.clone():this;return E(n,e,t)};var E=function(e,t,r){if(0===t.length){for(var n=e._data;f(n);)n=n[0];return n}return e._size=t.slice(0),e._data=s.resize(e._data,e._size,r),e};return d.prototype.clone=function(){var e=new d({data:u.clone(this._data),size:u.clone(this._size),datatype:this._datatype});return e},d.prototype.size=function(){return this._size.slice(0)},d.prototype.map=function(e){var t=this,r=function(n,i){return f(n)?n.map(function(e,t){return r(e,i.concat(t))}):e(n,i,t)};return new d({data:r(this._data,[]),size:u.clone(this._size),datatype:this._datatype})},d.prototype.forEach=function(e){var t=this,r=function(n,i){f(n)?n.forEach(function(e,t){r(e,i.concat(t))}):e(n,i,t)};r(this._data,[])},d.prototype.toArray=function(){return u.clone(this._data)},d.prototype.valueOf=function(){return this._data},d.prototype.format=function(e){return o.format(this._data,e)},d.prototype.toString=function(){return o.format(this._data)},d.prototype.toJSON=function(){return{mathjs:"DenseMatrix",data:this._data,size:this._size,datatype:this._datatype}},d.prototype.diagonal=function(e){if(e){if(e.isBigNumber===!0&&(e=e.toNumber()),!l(e)||!p(e))throw new TypeError("The parameter k must be an integer number")}else e=0;for(var t=e>0?e:0,r=0>e?-e:0,n=this._size[0],i=this._size[1],a=Math.min(n-r,i-t),o=[],s=0;a>s;s++)o[s]=this._data[s+r][s+t];return new d({data:o,size:[a],datatype:this._datatype})},d.diagonal=function(t,r,n,i,a){if(!f(t))throw new TypeError("Array expected, size parameter");if(2!==t.length)throw new Error("Only two dimensions matrix are supported");if(t=t.map(function(e){if(e&&e.isBigNumber===!0&&(e=e.toNumber()),!l(e)||!p(e)||1>e)throw new Error("Size values must be positive integers");return e}),n){if(n&&n.isBigNumber===!0&&(n=n.toNumber()),!l(n)||!p(n))throw new TypeError("The parameter k must be an integer number")}else n=0;i&&h(a)&&(i=c.convert(i,a));var o,u=n>0?n:0,m=0>n?-n:0,g=t[0],v=t[1],y=Math.min(g-m,v-u);if(f(r)){if(r.length!==y)throw new Error("Invalid value array length");o=function(e){return r[e]}}else if(r&&r.isMatrix===!0){var x=r.size();if(1!==x.length||x[0]!==y)throw new Error("Invalid matrix length");o=function(e){return r.get([e])}}else o=function(){return r};i||(i=o(0)&&o(0).isBigNumber===!0?new e.BigNumber(0):0);var b=[];if(t.length>0){b=s.resize(b,t,i);for(var w=0;y>w;w++)b[w+m][w+u]=o(w)}return new d({data:b,size:[g,v]})},d.fromJSON=function(e){return new d(e)},d.prototype.swapRows=function(e,t){if(!(l(e)&&p(e)&&l(t)&&p(t)))throw new Error("Row index must be positive integers");if(2!==this._size.length)throw new Error("Only two dimensional matrix is supported");return m(e,this._size[0]),m(t,this._size[0]),d._swapRows(e,t,this._data),this},d._swapRows=function(e,t,r){var n=r[e];r[e]=r[t],r[t]=n},e.Matrix._storage.dense=d,e.Matrix._storage["default"]=d,d}var i=r(39),a=r(42),o=i.string,s=i.array,u=i.object,c=i.number,f=Array.isArray,l=c.isNumber,p=c.isInteger,h=o.isString,m=s.validateIndex;t.name="DenseMatrix",t.path="type",t.factory=n,t.lazy=!1},function(e,t,r){"use strict";function n(e,t,n,d){function g(e,t){if(!(this instanceof g))throw new SyntaxError("Constructor must be called with the new operator");if(t&&!h(t))throw new Error("Invalid datatype: "+t);if(e&&e.isMatrix===!0)x(this,e,t);else if(e&&f(e.index)&&f(e.ptr)&&f(e.size))this._values=e.values,this._index=e.index,this._ptr=e.ptr,this._size=e.size,this._datatype=t||e.datatype;else if(f(e))b(this,e,t);else{if(e)throw new TypeError("Unsupported type of data ("+i.types.type(e)+")");this._values=[],this._index=[],this._ptr=[0],this._size=[0,0],this._datatype=t}}var v=n(r(38)),y=n(r(48)),x=function(e,t,r){"SparseMatrix"===t.type?(e._values=t._values?s.clone(t._values):void 0,e._index=s.clone(t._index),e._ptr=s.clone(t._ptr),e._size=s.clone(t._size),e._datatype=r||t._datatype):b(e,t.valueOf(),r||t._datatype)},b=function(e,t,r){e._values=[],e._index=[],e._ptr=[],e._datatype=r;var n=t.length,i=0,a=y,o=0;if(h(r)&&(a=d.find(y,[r,r])||y,o=d.convert(0,r)),n>0){var s=0;do{e._ptr.push(e._index.length);for(var u=0;n>u;u++){var c=t[u];if(f(c)){if(0===s&&i<c.length&&(i=c.length),s<c.length){var l=c[s];a(l,o)||(e._values.push(l),e._index.push(u))}}else 0===s&&1>i&&(i=1),a(c,o)||(e._values.push(c),e._index.push(u))}s++}while(i>s)}e._ptr.push(e._index.length),e._size=[n,i]};g.prototype=new v,g.prototype.type="SparseMatrix",g.prototype.isSparseMatrix=!0,g.prototype.storage=function(){return"sparse"},g.prototype.datatype=function(){return this._datatype},g.prototype.create=function(e,t){return new g(e,t)},g.prototype.density=function(){var e=this._size[0],t=this._size[1];return 0!==e&&0!==t?this._index.length/(e*t):0},g.prototype.subset=function(e,t,r){if(!this._values)throw new Error("Cannot invoke subset on a Pattern only matrix");switch(arguments.length){case 1:return w(this,e);case 2:case 3:return N(this,e,t,r);default:throw new SyntaxError("Wrong number of arguments")}};var w=function(e,t){if(!t||t.isIndex!==!0)throw new TypeError("Invalid index");var r=t.isScalar();if(r)return e.get(t.min());var n=t.size();if(n.length!=e._size.length)throw new a(n.length,e._size.length);var i,o,s,u,c=t.min(),f=t.max();for(i=0,o=e._size.length;o>i;i++)m(c[i],e._size[i]),m(f[i],e._size[i]);var l=e._values,p=e._index,h=e._ptr,d=t.dimension(0),v=t.dimension(1),y=[],x=[];d.forEach(function(e,t){x[e]=t[0],y[e]=!0});var b=l?[]:void 0,w=[],N=[];return v.forEach(function(e){for(N.push(w.length),s=h[e],u=h[e+1];u>s;s++)i=p[s],y[i]===!0&&(w.push(x[i]),b&&b.push(l[s]))}),N.push(w.length),new g({values:b,index:w,ptr:N,size:n,datatype:e._datatype})},N=function(e,t,r,n){if(!t||t.isIndex!==!0)throw new TypeError("Invalid index");var i,u=t.size(),c=t.isScalar();if(r&&r.isMatrix===!0?(i=r.size(),r=r.toArray()):i=o.size(r),c){if(0!==i.length)throw new TypeError("Scalar expected");e.set(t.min(),r,n)}else{if(1!==u.length&&2!==u.length)throw new a(u.length,e._size.length,"<");if(i.length<u.length){for(var f=0,l=0;1===u[f]&&1===i[f];)f++;for(;1===u[f];)l++,f++;r=o.unsqueeze(r,u.length,l,i)}if(!s.deepEqual(u,i))throw new a(u,i,">");for(var p=t.min()[0],h=t.min()[1],m=i[0],d=i[1],g=0;m>g;g++)for(var v=0;d>v;v++){var y=r[g][v];e.set([g+p,v+h],y,n)}}return e};g.prototype.get=function(e){if(!f(e))throw new TypeError("Array expected");if(e.length!=this._size.length)throw new a(e.length,this._size.length);if(!this._values)throw new Error("Cannot invoke get on a Pattern only matrix");var t=e[0],r=e[1];m(t,this._size[0]),m(r,this._size[1]);var n=E(t,this._ptr[r],this._ptr[r+1],this._index);return n<this._ptr[r+1]&&this._index[n]===t?this._values[n]:0},g.prototype.set=function(e,t,r){if(!f(e))throw new TypeError("Array expected");if(e.length!=this._size.length)throw new a(e.length,this._size.length);if(!this._values)throw new Error("Cannot invoke set on a Pattern only matrix");var n=e[0],i=e[1],o=this._size[0],s=this._size[1],u=y,c=0;h(this._datatype)&&(u=d.find(y,[this._datatype,this._datatype])||y,c=d.convert(0,this._datatype)),(n>o-1||i>s-1)&&(_(this,Math.max(n+1,o),Math.max(i+1,s),r),o=this._size[0],s=this._size[1]),m(n,o),m(i,s);var l=E(n,this._ptr[i],this._ptr[i+1],this._index);return l<this._ptr[i+1]&&this._index[l]===n?u(t,c)?M(l,i,this._values,this._index,this._ptr):this._values[l]=t:A(l,n,i,t,this._values,this._index,this._ptr),this};var E=function(e,t,r,n){if(r-t===0)return r;for(var i=t;r>i;i++)if(n[i]===e)return i;return t},M=function(e,t,r,n,i){r.splice(e,1),n.splice(e,1);for(var a=t+1;a<i.length;a++)i[a]--},A=function(e,t,r,n,i,a,o){i.splice(e,0,n),a.splice(e,0,t);for(var s=r+1;s<o.length;s++)o[s]++};g.prototype.resize=function(e,t,r){if(!f(e))throw new TypeError("Array expected");if(2!==e.length)throw new Error("Only two dimensions matrix are supported");e.forEach(function(t){if(!c.isNumber(t)||!c.isInteger(t)||0>t)throw new TypeError("Invalid size, must contain positive integers (size: "+u.format(e)+")")});var n=r?this.clone():this;return _(n,e[0],e[1],t)};var _=function(e,t,r,n){var i=n||0,a=y,o=0;h(e._datatype)&&(a=d.find(y,[e._datatype,e._datatype])||y,o=d.convert(0,e._datatype),i=d.convert(i,e._datatype));var s,u,c,f=!a(i,o),l=e._size[0],p=e._size[1];if(r>p){for(u=p;r>u;u++)if(e._ptr[u]=e._values.length,f)for(s=0;l>s;s++)e._values.push(i),e._index.push(s);e._ptr[r]=e._values.length}else p>r&&(e._ptr.splice(r+1,p-r),e._values.splice(e._ptr[r],e._values.length),e._index.splice(e._ptr[r],e._index.length));if(p=r,t>l){if(f){var m=0;for(u=0;p>u;u++){e._ptr[u]=e._ptr[u]+m,c=e._ptr[u+1]+m;var g=0;for(s=l;t>s;s++,g++)e._values.splice(c+g,0,i),e._index.splice(c+g,0,s),m++}e._ptr[p]=e._values.length}}else if(l>t){var v=0;for(u=0;p>u;u++){e._ptr[u]=e._ptr[u]-v;var x=e._ptr[u],b=e._ptr[u+1]-v;for(c=x;b>c;c++)s=e._index[c],s>t-1&&(e._values.splice(c,1),e._index.splice(c,1),v++)}e._ptr[u]=e._values.length}return e._size[0]=t,e._size[1]=r,e};g.prototype.clone=function(){var e=new g({values:this._values?s.clone(this._values):void 0,index:s.clone(this._index),ptr:s.clone(this._ptr),size:s.clone(this._size),datatype:this._datatype});return e},g.prototype.size=function(){return this._size.slice(0)},g.prototype.map=function(e,t){if(!this._values)throw new Error("Cannot invoke map on a Pattern only matrix");var r=this,n=this._size[0],i=this._size[1],a=function(t,n,i){return e(t,[n,i],r)};return O(this,0,n-1,0,i-1,a,t)};var O=function(e,t,r,n,i,a,o){var s=[],u=[],c=[],f=y,l=0;h(e._datatype)&&(f=d.find(y,[e._datatype,e._datatype])||y,l=d.convert(0,e._datatype));for(var p=function(e,t,r){e=a(e,t,r),f(e,l)||(s.push(e),u.push(t))},m=n;i>=m;m++){c.push(s.length);for(var v=e._ptr[m],x=e._ptr[m+1],b=t,w=v;x>w;w++){var N=e._index[w];if(N>=t&&r>=N){if(!o)for(var E=b;N>E;E++)p(0,E-t,m-n);p(e._values[w],N-t,m-n)}b=N+1}if(!o)for(var M=b;r>=M;M++)p(0,M-t,m-n)}return c.push(s.length),new g({values:s,index:u,ptr:c,size:[r-t+1,i-n+1]})};g.prototype.forEach=function(e,t){if(!this._values)throw new Error("Cannot invoke forEach on a Pattern only matrix");for(var r=this,n=this._size[0],i=this._size[1],a=0;i>a;a++){for(var o=this._ptr[a],s=this._ptr[a+1],u=0,c=o;s>c;c++){var f=this._index[c];if(!t)for(var l=u;f>l;l++)e(0,[l,a],r);e(this._values[c],[f,a],r),u=f+1}if(!t)for(var p=u;n>p;p++)e(0,[p,a],r)}},g.prototype.toArray=function(){return T(this._values,this._index,this._ptr,this._size,!0)},g.prototype.valueOf=function(){return T(this._values,this._index,this._ptr,this._size,!1)};var T=function(e,t,r,n,i){var a,o,u=n[0],c=n[1],f=[];for(a=0;u>a;a++)for(f[a]=[],o=0;c>o;o++)f[a][o]=0;for(o=0;c>o;o++)for(var l=r[o],p=r[o+1],h=l;p>h;h++)a=t[h],f[a][o]=e?i?s.clone(e[h]):e[h]:1;return f};return g.prototype.format=function(e){for(var t=this._size[0],r=this._size[1],n=this.density(),i="Sparse Matrix ["+u.format(t,e)+" x "+u.format(r,e)+"] density: "+u.format(n,e)+"\n",a=0;r>a;a++)for(var o=this._ptr[a],s=this._ptr[a+1],c=o;s>c;c++){var f=this._index[c];i+="\n    ("+u.format(f,e)+", "+u.format(a,e)+") ==> "+(this._values?u.format(this._values[c],e):"X")}return i},g.prototype.toString=function(){return u.format(this.toArray())},g.prototype.toJSON=function(){return{mathjs:"SparseMatrix",values:this._values,index:this._index,ptr:this._ptr,size:this._size,datatype:this._datatype}},g.prototype.diagonal=function(e){if(e){if(e.isBigNumber===!0&&(e=e.toNumber()),!l(e)||!p(e))throw new TypeError("The parameter k must be an integer number")}else e=0;var t=e>0?e:0,r=0>e?-e:0,n=this._size[0],i=this._size[1],a=Math.min(n-r,i-t),o=[],s=[],u=[];u[0]=0;for(var c=t;i>c&&o.length<a;c++)for(var f=this._ptr[c],h=this._ptr[c+1],m=f;h>m;m++){var d=this._index[m];if(d===c-t+r){o.push(this._values[m]),s[o.length-1]=d-r;break}}return u.push(o.length),new g({values:o,index:s,ptr:u,size:[a,1]})},g.fromJSON=function(e){return new g(e)},g.diagonal=function(e,t,r,n,i){if(!f(e))throw new TypeError("Array expected, size parameter");if(2!==e.length)throw new Error("Only two dimensions matrix are supported");if(e=e.map(function(e){if(e&&e.isBigNumber===!0&&(e=e.toNumber()),!l(e)||!p(e)||1>e)throw new Error("Size values must be positive integers");return e}),r){if(r.isBigNumber===!0&&(r=r.toNumber()),!l(r)||!p(r))throw new TypeError("The parameter k must be an integer number")}else r=0;var a=y,o=0;h(i)&&(a=d.find(y,[i,i])||y,o=d.convert(0,i));var s,u=r>0?r:0,c=0>r?-r:0,m=e[0],v=e[1],x=Math.min(m-c,v-u);if(f(t)){if(t.length!==x)throw new Error("Invalid value array length");s=function(e){return t[e]}}else if(t&&t.isMatrix===!0){var b=t.size();if(1!==b.length||b[0]!==x)throw new Error("Invalid matrix length");s=function(e){return t.get([e])}}else s=function(){return t};for(var w=[],N=[],E=[],M=0;v>M;M++){E.push(w.length);var A=M-u;if(A>=0&&x>A){var _=s(A);a(_,o)||(N.push(A+c),w.push(_))}}return E.push(w.length),new g({values:w,index:N,ptr:E,size:[m,v]})},g.prototype.swapRows=function(e,t){if(!(l(e)&&p(e)&&l(t)&&p(t)))throw new Error("Row index must be positive integers");if(2!==this._size.length)throw new Error("Only two dimensional matrix is supported");return m(e,this._size[0]),m(t,this._size[0]),g._swapRows(e,t,this._size[1],this._values,this._index,this._ptr),this},g._forEachRow=function(e,t,r,n,i){for(var a=n[e],o=n[e+1],s=a;o>s;s++)i(r[s],t[s])},g._swapRows=function(e,t,r,n,i,a){for(var o=0;r>o;o++){var s=a[o],u=a[o+1],c=E(e,s,u,i),f=E(t,s,u,i);if(u>c&&u>f&&i[c]===e&&i[f]===t){if(n){var l=n[c];n[c]=n[f],n[f]=l}}else if(u>c&&i[c]===e&&(f>=u||i[f]!==t)){var p=n?n[c]:void 0;i.splice(f,0,t),n&&n.splice(f,0,p),i.splice(c>=f?c+1:c,1),n&&n.splice(c>=f?c+1:c,1)}else if(u>f&&i[f]===t&&(c>=u||i[c]!==e)){var h=n?n[f]:void 0;i.splice(c,0,e),n&&n.splice(c,0,h),i.splice(f>=c?f+1:f,1),n&&n.splice(f>=c?f+1:f,1)}}},e.Matrix._storage.sparse=g,g}var i=r(39),a=r(42),o=i.array,s=i.object,u=i.string,c=i.number,f=Array.isArray,l=c.isNumber,p=c.isInteger,h=u.isString,m=o.validateIndex;t.name="SparseMatrix",t.path="type",t.factory=n,t.lazy=!1},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("equalScalar",{"boolean, boolean":function(e,t){return e===t},"number, number":function(e,r){return e===r||i(e,r,t.epsilon)},"BigNumber, BigNumber":function(e,r){return e.eq(r)||a(e,r,t.epsilon)},"Fraction, Fraction":function(e,t){return e.equals(t)},"Complex, Complex":function(e,t){return e.equals(t)},"Unit, Unit":function(e,t){if(!e.equalBase(t))throw new Error("Cannot compare units with different base");return o(e.value,t.value)},"string, string":function(e,t){return e===t}});return o}var i=r(6).nearlyEqual,a=r(49);t.factory=n},function(e,t){"use strict";e.exports=function(e,t,r){if(null==r)return e.eq(t);if(e.eq(t))return!0;if(e.isNaN()||t.isNaN())return!1;if(e.isFinite()&&t.isFinite()){var n=e.minus(t).abs();if(n.isZero())return!0;var i=e.constructor.max(e.abs(),t.abs());return n.lte(i.times(r))}return!1}},function(e,t,r){"use strict";function n(e,t,n){function i(){if(!(this instanceof i))throw new SyntaxError("Constructor must be called with the new operator");this._values=[],this._heap=new e.FibonacciHeap}var a=n(r(51)),o=n(r(48));return i.prototype.type="Spa",i.prototype.isSpa=!0,i.prototype.set=function(e,t){if(this._values[e])this._values[e].value=t;else{var r=this._heap.insert(e,t);this._values[e]=r}},i.prototype.get=function(e){var t=this._values[e];return t?t.value:0},i.prototype.accumulate=function(e,t){var r=this._values[e];r?r.value=a(r.value,t):(r=this._heap.insert(e,t),this._values[e]=r)},i.prototype.forEach=function(e,t,r){var n=this._heap,i=this._values,a=[],s=n.extractMinimum();for(s&&a.push(s);s&&s.key<=t;)s.key>=e&&(o(s.value,0)||r(s.key,s.value,this)),s=n.extractMinimum(),s&&a.push(s);for(var u=0;u<a.length;u++){var c=a[u];s=n.insert(c.key,c.value),i[s.key]=s}},i.prototype.swap=function(e,t){var r=this._values[e],n=this._values[t];if(!r&&n)r=this._heap.insert(e,n.value),this._heap.remove(n),this._values[e]=r,this._values[t]=void 0;else if(r&&!n)n=this._heap.insert(t,r.value),this._heap.remove(r),this._values[t]=n,this._values[e]=void 0;else if(r&&n){var i=r.value;r.value=n.value,n.value=i}},i}t.name="Spa",t.path="type",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(52)),s=n(r(53)),u=r(32),c=n(r(54)),f=n(r(55)),l=n(r(56)),p=n(r(57)),h=n(r(58)),m=a("add",i({"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=f(e,t,s);break;default:r=c(t,e,s,!0)}break;default:switch(t.storage()){case"sparse":r=c(e,t,s,!1);break;default:r=p(e,t,s)}}return r},"Array, Array":function(e,t){return m(o(e),o(t)).valueOf()},"Array, Matrix":function(e,t){return m(o(e),t)},"Matrix, Array":function(e,t){return m(e,o(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=l(e,t,s,!1);break;default:r=h(e,t,s,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=l(t,e,s,!0);break;default:r=h(t,e,s,!0)}return r},"Array, any":function(e,t){return h(o(e),t,s,!1).valueOf()},"any, Array":function(e,t){return h(o(t),e,s,!0).valueOf()}},s.signatures));return m.toTex={2:"\\left(${args[0]}"+u.operators.add+"${args[1]}\\right)"},m}var i=r(3).extend;t.name="add",t.factory=n},function(e,t){"use strict";function r(e,t,r,n){function i(t,r,n){var i=e.Matrix.storage(r||"default");return new i(t,n)}var a=n("matrix",{"":function(){return i([])},string:function(e){return i([],e)},"string, string":function(e,t){
return i([],e,t)},Array:function(e){return i(e)},Matrix:function(e){return i(e,e.storage())},"Array | Matrix, string":i,"Array | Matrix, string, string":i});return a.toTex={0:"\\begin{bmatrix}\\end{bmatrix}",1:"\\left(${args[0]}\\right)",2:"\\left(${args[0]}\\right)"},a}t.name="matrix",t.factory=r},function(e,t){"use strict";function r(e,t,r,n){var i=n("add",{"number, number":function(e,t){return e+t},"Complex, Complex":function(e,t){return e.add(t)},"BigNumber, BigNumber":function(e,t){return e.plus(t)},"Fraction, Fraction":function(e,t){return e.add(t)},"Unit, Unit":function(e,t){if(null==e.value)throw new Error("Parameter x contains a unit with undefined value");if(null==t.value)throw new Error("Parameter y contains a unit with undefined value");if(!e.equalBase(t))throw new Error("Units do not match");var r=e.clone();return r.value=i(r.value,t.value),r.fixPrefix=!1,r}});return i}t.factory=r},function(e,t,r){"use strict";function n(e,t,r,n){var a=e.DenseMatrix,o=function(e,t,r,o){var s=e._data,u=e._size,c=e._datatype,f=t._values,l=t._index,p=t._ptr,h=t._size,m=t._datatype;if(u.length!==h.length)throw new i(u.length,h.length);if(u[0]!==h[0]||u[1]!==h[1])throw new RangeError("Dimension mismatch. Matrix A ("+u+") must match Matrix B ("+h+")");if(!f)throw new Error("Cannot perform operation on Dense Matrix and Pattern Sparse Matrix");var d,g,v=u[0],y=u[1],x="string"==typeof c&&c===m?c:void 0,b=x?n.find(r,[x,x]):r,w=[];for(d=0;v>d;d++)w[d]=[];var N=[],E=[];for(g=0;y>g;g++){for(var M=g+1,A=p[g],_=p[g+1],O=A;_>O;O++)d=l[O],N[d]=o?b(f[O],s[d][g]):b(s[d][g],f[O]),E[d]=M;for(d=0;v>d;d++)E[d]===M?w[d][g]=N[d]:w[d][g]=s[d][g]}return new a({data:w,size:[v,y],datatype:x})};return o}var i=r(42);t.name="algorithm01",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(48)),s=e.SparseMatrix,u=function(e,t,r){var n=e._values,u=e._index,c=e._ptr,f=e._size,l=e._datatype,p=t._values,h=t._index,m=t._ptr,d=t._size,g=t._datatype;if(f.length!==d.length)throw new i(f.length,d.length);if(f[0]!==d[0]||f[1]!==d[1])throw new RangeError("Dimension mismatch. Matrix A ("+f+") must match Matrix B ("+d+")");var v,y=f[0],x=f[1],b=o,w=0,N=r;"string"==typeof l&&l===g&&(v=l,b=a.find(o,[v,v]),w=a.convert(0,v),N=a.find(r,[v,v]));var E,M,A,_,O,T=n&&p?[]:void 0,C=[],S=[],z=new s({values:T,index:C,ptr:S,size:[y,x],datatype:v}),B=n&&p?[]:void 0,k=n&&p?[]:void 0,I=[],R=[];for(M=0;x>M;M++){S[M]=C.length;var P=M+1;for(_=c[M],O=c[M+1],A=_;O>A;A++)E=u[A],C.push(E),I[E]=P,B&&(B[E]=n[A]);for(_=m[M],O=m[M+1],A=_;O>A;A++)if(E=h[A],I[E]===P){if(B){var U=N(B[E],p[A]);b(U,w)?I[E]=null:B[E]=U}}else C.push(E),R[E]=P,k&&(k[E]=p[A]);if(B&&k)for(A=S[M];A<C.length;)E=C[A],I[E]===P?(T[A]=B[E],A++):R[E]===P?(T[A]=k[E],A++):C.splice(A,1)}return S[x]=C.length,z};return u}var i=r(42);t.name="algorithm04",t.factory=n},function(e,t){"use strict";function r(e,t,r,n){var i=e.DenseMatrix,a=function(e,t,r,a){var o=e._values,s=e._index,u=e._ptr,c=e._size,f=e._datatype;if(!o)throw new Error("Cannot perform operation on Pattern Sparse Matrix and Scalar value");var l,p=c[0],h=c[1],m=r;"string"==typeof f&&(l=f,t=n.convert(t,l),m=n.find(r,[l,l]));for(var d=[],g=new i({data:d,size:[p,h],datatype:l}),v=[],y=[],x=0;h>x;x++){for(var b=x+1,w=u[x],N=u[x+1],E=w;N>E;E++){var M=s[E];v[M]=o[E],y[M]=b}for(var A=0;p>A;A++)0===x&&(d[A]=[]),y[A]===b?d[A][x]=a?m(t,v[A]):m(v[A],t):d[A][x]=t}return g};return a}t.name="algorithm10",t.factory=r},function(e,t,r){"use strict";function n(e,t,r,n){var i=e.DenseMatrix,o=function(e,t,r){var o=e._data,u=e._size,c=e._datatype,f=t._data,l=t._size,p=t._datatype,h=[];if(u.length!==l.length)throw new a(u.length,l.length);for(var m=0;m<u.length;m++){if(u[m]!==l[m])throw new RangeError("Dimension mismatch. Matrix A ("+u+") must match Matrix B ("+l+")");h[m]=u[m]}var d,g=r;"string"==typeof c&&c===p&&(d=c,t=n.convert(t,d),g=n.find(r,[d,d]));var v=h.length>0?s(g,0,h,h[0],o,f):[];return new i({data:v,size:h,datatype:d})},s=function(e,t,r,n,i,a){var o=[];if(t===r.length-1)for(var u=0;n>u;u++)o[u]=e(i[u],a[u]);else for(var c=0;n>c;c++)o[c]=s(e,t+1,r,r[t+1],i[c],a[c]);return o};return o}var i=r(39),a=r(42),o=i.string;o.isString;t.name="algorithm13",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=e.DenseMatrix,o=function(e,t,r,o){var u,c=e._data,f=e._size,l=e._datatype,p=r;"string"==typeof l&&(u=l,t=n.convert(t,u),p=n.find(r,[u,u]));var h=f.length>0?s(p,0,f,f[0],c,t,o):[];return new a({data:h,size:i(f),datatype:u})},s=function(e,t,r,n,i,a,o){var u=[];if(t===r.length-1)for(var c=0;n>c;c++)u[c]=o?e(a,i[c]):e(i[c],a);else for(var f=0;n>f;f++)u[f]=s(e,t+1,r,r[t+1],i[f],a,o);return u};return o}var i=r(3).clone;t.name="algorithm14",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");this._minimum=null,this._size=0}var o=n(r(60)),s=n(r(64)),u=1/Math.log((1+Math.sqrt(5))/2);a.prototype.type="FibonacciHeap",a.prototype.isFibonacciHeap=!0,a.prototype.insert=function(e,t){var r={key:e,value:t,degree:0};if(this._minimum){var n=this._minimum;r.left=n,r.right=n.right,n.right=r,r.right.left=r,o(e,n.key)&&(this._minimum=r)}else r.left=r,r.right=r,this._minimum=r;return this._size++,r},a.prototype.size=function(){return this._size},a.prototype.clear=function(){this._minimum=null,this._size=0},a.prototype.isEmpty=function(){return!!this._minimum},a.prototype.extractMinimum=function(){var e=this._minimum;if(null===e)return e;for(var t=this._minimum,r=e.degree,n=e.child;r>0;){var i=n.right;n.left.right=n.right,n.right.left=n.left,n.left=t,n.right=t.right,t.right=n,n.right.left=n,n.parent=null,n=i,r--}return e.left.right=e.right,e.right.left=e.left,e==e.right?t=null:(t=e.right,t=h(t,this._size)),this._size--,this._minimum=t,e},a.prototype.remove=function(e){this._minimum=c(this._minimum,e,-1),this.extractMinimum()};var c=function(e,t,r){t.key=r;var n=t.parent;return n&&o(t.key,n.key)&&(f(e,t,n),l(e,n)),o(t.key,e.key)&&(e=t),e},f=function(e,t,r){t.left.right=t.right,t.right.left=t.left,r.degree--,r.child==t&&(r.child=t.right),0===r.degree&&(r.child=null),t.left=e,t.right=e.right,e.right=t,t.right.left=t,t.parent=null,t.mark=!1},l=function(e,t){var r=t.parent;r&&(t.mark?(f(e,t,r),l(r)):t.mark=!0)},p=function(e,t){e.left.right=e.right,e.right.left=e.left,e.parent=t,t.child?(e.left=t.child,e.right=t.child.right,t.child.right=e,e.right.left=e):(t.child=e,e.right=e,e.left=e),t.degree++,e.mark=!1},h=function(e,t){var r=Math.floor(Math.log(t)*u)+1,n=new Array(r),i=0,a=e;if(a)for(i++,a=a.right;a!==e;)i++,a=a.right;for(var c;i>0;){for(var f=a.degree,l=a.right;;){if(c=n[f],!c)break;if(s(a.key,c.key)){var h=c;c=a,a=h}p(c,a),n[f]=null,f++}n[f]=a,a=l,i--}e=null;for(var m=0;r>m;m++)c=n[m],c&&(e?(c.left.right=c.right,c.right.left=c.left,c.left=e,c.right=e.right,e.right=c,c.right.left=c,o(c.key,e.key)&&(e=c)):e=c);return e};return a}t.name="FibonacciHeap",t.path="type",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=n(r(61)),c=n(r(62)),f=n(r(63)),l=n(r(57)),p=n(r(58)),h=r(32),m=o("smaller",{"boolean, boolean":function(e,t){return t>e},"number, number":function(e,r){return r>e&&!i(e,r,t.epsilon)},"BigNumber, BigNumber":function(e,r){return e.lt(r)&&!a(e,r,t.epsilon)},"Fraction, Fraction":function(e,t){return-1===e.compare(t)},"Complex, Complex":function(e,t){throw new TypeError("No ordering relation is defined for complex numbers")},"Unit, Unit":function(e,t){if(!e.equalBase(t))throw new Error("Cannot compare units with different base");return m(e.value,t.value)},"string, string":function(e,t){return t>e},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,m);break;default:r=u(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,m,!1);break;default:r=l(e,t,m)}}return r},"Array, Array":function(e,t){return m(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return m(s(e),t)},"Matrix, Array":function(e,t){return m(e,s(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,m,!1);break;default:r=p(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,m,!0);break;default:r=p(t,e,m,!0)}return r},"Array, any":function(e,t){return p(s(e),t,m,!1).valueOf()},"any, Array":function(e,t){return p(s(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+h.operators.smaller+"${args[1]}\\right)"},m}var i=r(6).nearlyEqual,a=r(49);t.name="smaller",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=e.DenseMatrix,o=function(e,t,r,o){var s=e._data,u=e._size,c=e._datatype,f=t._values,l=t._index,p=t._ptr,h=t._size,m=t._datatype;if(u.length!==h.length)throw new i(u.length,h.length);if(u[0]!==h[0]||u[1]!==h[1])throw new RangeError("Dimension mismatch. Matrix A ("+u+") must match Matrix B ("+h+")");if(!f)throw new Error("Cannot perform operation on Dense Matrix and Pattern Sparse Matrix");var d,g=u[0],v=u[1],y=0,x=r;"string"==typeof c&&c===m&&(d=c,y=n.convert(0,d),x=n.find(r,[d,d]));for(var b=[],w=0;g>w;w++)b[w]=[];for(var N=[],E=[],M=0;v>M;M++){for(var A=M+1,_=p[M],O=p[M+1],T=_;O>T;T++){var C=l[T];N[C]=o?x(f[T],s[C][M]):x(s[C][M],f[T]),E[C]=A}for(var S=0;g>S;S++)E[S]===A?b[S][M]=N[S]:b[S][M]=o?x(y,s[S][M]):x(s[S][M],y)}return new a({data:b,size:[g,v],datatype:d})};return o}var i=r(42);t.name="algorithm03",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=e.DenseMatrix,o=function(e,t,r){var o=e._size,u=e._datatype,c=t._size,f=t._datatype;if(o.length!==c.length)throw new i(o.length,c.length);if(o[0]!==c[0]||o[1]!==c[1])throw new RangeError("Dimension mismatch. Matrix A ("+o+") must match Matrix B ("+c+")");var l,p=o[0],h=o[1],m=0,d=r;"string"==typeof u&&u===f&&(l=u,m=n.convert(0,l),d=n.find(r,[l,l]));var g,v,y=[];for(g=0;p>g;g++)y[g]=[];var x=new a({data:y,size:[p,h],datatype:l}),b=[],w=[],N=[],E=[];for(v=0;h>v;v++){var M=v+1;for(s(e,v,N,b,M),s(t,v,E,w,M),g=0;p>g;g++){var A=N[g]===M?b[g]:m,_=E[g]===M?w[g]:m;y[g][v]=d(A,_)}}return x},s=function(e,t,r,n,i){for(var a=e._values,o=e._index,s=e._ptr,u=s[t],c=s[t+1];c>u;u++){var f=o[u];r[f]=i,n[f]=a[u]}};return o}var i=r(42);t.name="algorithm07",t.factory=n},function(e,t){"use strict";function r(e,t,r,n){var i=e.DenseMatrix,a=function(e,t,r,a){var o=e._values,s=e._index,u=e._ptr,c=e._size,f=e._datatype;if(!o)throw new Error("Cannot perform operation on Pattern Sparse Matrix and Scalar value");var l,p=c[0],h=c[1],m=r;"string"==typeof f&&(l=f,t=n.convert(t,l),m=n.find(r,[l,l]));for(var d=[],g=new i({data:d,size:[p,h],datatype:l}),v=[],y=[],x=0;h>x;x++){for(var b=x+1,w=u[x],N=u[x+1],E=w;N>E;E++){var M=s[E];v[M]=o[E],y[M]=b}for(var A=0;p>A;A++)0===x&&(d[A]=[]),y[A]===b?d[A][x]=a?m(t,v[A]):m(v[A],t):d[A][x]=a?m(t,0):m(0,t)}return g};return a}t.name="algorithm12",t.factory=r},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=n(r(61)),c=n(r(62)),f=n(r(63)),l=n(r(57)),p=n(r(58)),h=r(32),m=o("larger",{"boolean, boolean":function(e,t){return e>t},"number, number":function(e,r){return e>r&&!i(e,r,t.epsilon)},"BigNumber, BigNumber":function(e,r){return e.gt(r)&&!a(e,r,t.epsilon)},"Fraction, Fraction":function(e,t){return 1===e.compare(t)},"Complex, Complex":function(){throw new TypeError("No ordering relation is defined for complex numbers")},"Unit, Unit":function(e,t){if(!e.equalBase(t))throw new Error("Cannot compare units with different base");return m(e.value,t.value)},"string, string":function(e,t){return e>t},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,m);break;default:r=u(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,m,!1);break;default:r=l(e,t,m)}}return r},"Array, Array":function(e,t){return m(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return m(s(e),t)},"Matrix, Array":function(e,t){return m(e,s(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,m,!1);break;default:r=p(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,m,!0);break;default:r=p(t,e,m,!0)}return r},"Array, any":function(e,t){return p(s(e),t,m,!1).valueOf()},"any, Array":function(e,t){return p(s(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+h.operators.larger+"${args[1]}\\right)"},m}var i=r(6).nearlyEqual,a=r(49);t.name="larger",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){function a(e,t){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(t&&!u(t))throw new Error("Invalid datatype: "+t);if(e&&e.isMatrix===!0||s(e)){var r=new c(e,t);this._data=r._data,this._size=r._size,this._datatype=r._datatype,this._min=null,this._max=null}else if(e&&s(e.data)&&s(e.size))this._data=e.data,this._size=e.size,this._datatype=e.datatype,this._min="undefined"!=typeof e.min?e.min:null,this._max="undefined"!=typeof e.max?e.max:null;else{if(e)throw new TypeError("Unsupported type of data ("+i.types.type(e)+")");this._data=[],this._size=[0],this._datatype=t,this._min=null,this._max=null}}var c=n(r(46)),f=n(r(60));return a.prototype=new c,a.prototype.type="ImmutableDenseMatrix",a.prototype.isImmutableDenseMatrix=!0,a.prototype.subset=function(e){switch(arguments.length){case 1:var t=c.prototype.subset.call(this,e);return t.isMatrix?new a({data:t._data,size:t._size,datatype:t._datatype}):t;case 2:case 3:throw new Error("Cannot invoke set subset on an Immutable Matrix instance");default:throw new SyntaxError("Wrong number of arguments")}},a.prototype.set=function(){throw new Error("Cannot invoke set on an Immutable Matrix instance")},a.prototype.resize=function(){throw new Error("Cannot invoke resize on an Immutable Matrix instance")},a.prototype.clone=function(){var e=new a({data:o.clone(this._data),size:o.clone(this._size),datatype:this._datatype});return e},a.prototype.toJSON=function(){return{mathjs:"ImmutableDenseMatrix",data:this._data,size:this._size,datatype:this._datatype}},a.fromJSON=function(e){return new a(e)},a.prototype.swapRows=function(){throw new Error("Cannot invoke swapRows on an Immutable Matrix instance")},a.prototype.min=function(){if(null===this._min){var e=null;this.forEach(function(t){(null===e||f(t,e))&&(e=t)}),this._min=null!==e?e:void 0}return this._min},a.prototype.max=function(){if(null===this._max){var e=null;this.forEach(function(t){(null===e||f(e,t))&&(e=t)}),this._max=null!==e?e:void 0}return this._max},a}var i=r(39),a=i.string,o=i.object,s=Array.isArray,u=a.isString;t.name="ImmutableDenseMatrix",t.path="type",t.factory=n},function(e,t,r){"use strict";function n(e){function t(e){if(!(this instanceof t))throw new SyntaxError("Constructor must be called with the new operator");this._dimensions=[],this._isScalar=!0;for(var n=0,i=arguments.length;i>n;n++){var a=arguments[n];if(a&&a.isRange===!0)this._dimensions.push(a),this._isScalar=!1;else if(a&&(Array.isArray(a)||a.isMatrix===!0)){var o=r(a.valueOf());this._dimensions.push(o);var s=o.size();1===s.length&&1===s[0]||(this._isScalar=!1)}else if("number"==typeof a)this._dimensions.push(r([a]));else{if("string"!=typeof a)throw new TypeError("Dimension must be an Array, Matrix, number, string, or Range");this._dimensions.push(a)}}}function r(t){for(var r=0,n=t.length;n>r;r++)if("number"!=typeof t[r]||!a(t[r]))throw new TypeError("Index parameters must be positive integer numbers");return new e.ImmutableDenseMatrix(t)}return t.prototype.type="Index",t.prototype.isIndex=!0,t.prototype.clone=function(){var e=new t;return e._dimensions=i(this._dimensions),e._isScalar=this._isScalar,e},t.create=function(e){var r=new t;return t.apply(r,e),r},t.prototype.size=function(){for(var e=[],t=0,r=this._dimensions.length;r>t;t++){var n=this._dimensions[t];e[t]="string"==typeof n?1:n.size()[0]}return e},t.prototype.max=function(){for(var e=[],t=0,r=this._dimensions.length;r>t;t++){var n=this._dimensions[t];e[t]="string"==typeof n?n:n.max()}return e},t.prototype.min=function(){for(var e=[],t=0,r=this._dimensions.length;r>t;t++){var n=this._dimensions[t];e[t]="string"==typeof n?n:n.min()}return e},t.prototype.forEach=function(e){for(var t=0,r=this._dimensions.length;r>t;t++)e(this._dimensions[t],t,this)},t.prototype.dimension=function(e){return this._dimensions[e]||null},t.prototype.isObjectProperty=function(){return 1===this._dimensions.length&&"string"==typeof this._dimensions[0]},t.prototype.getObjectProperty=function(){return this.isObjectProperty()?this._dimensions[0]:null},t.prototype.isScalar=function(){return this._isScalar},t.prototype.toArray=function(){for(var e=[],t=0,r=this._dimensions.length;r>t;t++){var n=this._dimensions[t];e.push("string"==typeof n?n:n.toArray())}return e},t.prototype.valueOf=t.prototype.toArray,t.prototype.toString=function(){for(var e=[],t=0,r=this._dimensions.length;r>t;t++){var n=this._dimensions[t];"string"==typeof n?e.push(JSON.stringify(n)):e.push(n.toString())}return"["+e.join(", ")+"]"},t.prototype.toJSON=function(){return{mathjs:"Index",dimensions:this._dimensions}},t.fromJSON=function(e){return t.create(e.dimensions)},t}var i=r(3).clone,a=r(6).isInteger;t.name="Index",t.path="type",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){function a(e,t,r){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(null!=e)if(e.isBigNumber===!0)e=e.toNumber();else if("number"!=typeof e)throw new TypeError("Parameter start must be a number");if(null!=t)if(t.isBigNumber===!0)t=t.toNumber();else if("number"!=typeof t)throw new TypeError("Parameter end must be a number");if(null!=r)if(r.isBigNumber===!0)r=r.toNumber();else if("number"!=typeof r)throw new TypeError("Parameter step must be a number");this.start=null!=e?parseFloat(e):0,this.end=null!=t?parseFloat(t):0,this.step=null!=r?parseFloat(r):1}return a.prototype.type="Range",a.prototype.isRange=!0,a.parse=function(e){if("string"!=typeof e)return null;var t=e.split(":"),r=t.map(function(e){return parseFloat(e)}),n=r.some(function(e){return isNaN(e)});if(n)return null;switch(r.length){case 2:return new a(r[0],r[1]);case 3:return new a(r[0],r[2],r[1]);default:return null}},a.prototype.clone=function(){return new a(this.start,this.end,this.step)},a.prototype.size=function(){var e=0,t=this.start,r=this.step,n=this.end,a=n-t;return i.sign(r)==i.sign(a)?e=Math.ceil(a/r):0==a&&(e=0),isNaN(e)&&(e=0),[e]},a.prototype.min=function(){var e=this.size()[0];return e>0?this.step>0?this.start:this.start+(e-1)*this.step:void 0},a.prototype.max=function(){var e=this.size()[0];return e>0?this.step>0?this.start+(e-1)*this.step:this.start:void 0},a.prototype.forEach=function(e){var t=this.start,r=this.step,n=this.end,i=0;if(r>0)for(;n>t;)e(t,[i],this),t+=r,i++;else if(0>r)for(;t>n;)e(t,[i],this),t+=r,i++},a.prototype.map=function(e){var t=[];return this.forEach(function(r,n,i){t[n[0]]=e(r,n,i)}),t},a.prototype.toArray=function(){var e=[];return this.forEach(function(t,r){e[r[0]]=t}),e},a.prototype.valueOf=function(){return this.toArray()},a.prototype.format=function(e){var t=i.format(this.start,e);return 1!=this.step&&(t+=":"+i.format(this.step,e)),t+=":"+i.format(this.end,e)},a.prototype.toString=function(){return this.format()},a.prototype.toJSON=function(){return{mathjs:"Range",start:this.start,end:this.end,step:this.step}},a.fromJSON=function(e){return new a(e.start,e.end,e.step)},a}var i=r(6);t.name="Range",t.path="type",t.factory=n},function(e,t){"use strict";function r(e,t,r,n){return n("index",{"...number | string | BigNumber | Range | Array | Matrix":function(t){var r=t.map(function(e){return e&&e.isBigNumber===!0?e.toNumber():e&&(Array.isArray(e)||e.isMatrix===!0)?e.map(function(e){return e&&e.isBigNumber===!0?e.toNumber():e}):e}),n=new e.Index;return e.Index.apply(n,r),n}})}t.name="index",t.factory=r},function(e,t){"use strict";function r(e,t,r,n){var i=e.SparseMatrix,a=n("sparse",{"":function(){return new i([])},string:function(e){return new i([],e)},"Array | Matrix":function(e){return new i(e)},"Array | Matrix, string":function(e,t){return new i(e,t)}});return a.toTex={0:"\\begin{bsparse}\\end{bsparse}",1:"\\left(${args[0]}\\right)"},a}t.name="sparse",t.factory=r},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("number",{"":function(){return 0},number:function(e){return e},string:function(e){var t=Number(e);if(isNaN(t))throw new SyntaxError('String "'+e+'" is no valid number');return t},BigNumber:function(e){return e.toNumber()},Fraction:function(e){return e.valueOf()},Unit:function(e){throw new Error("Second argument with valueless unit expected")},"Unit, string | Unit":function(e,t){return e.toNumber(t)},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={0:"0",1:"\\left(${args[0]}\\right)",2:"\\left(\\left(${args[0]}\\right)${args[1]}\\right)"},a}var i=r(19);t.name="number",t.factory=n},function(e,t,r){e.exports=[r(72)]},function(e,t){"use strict";function r(e,t,r,n){function i(e){if(!(this instanceof i))throw new SyntaxError("Constructor must be called with the new operator");this.entries=e||[]}return i.prototype.type="ResultSet",i.prototype.isResultSet=!0,i.prototype.valueOf=function(){return this.entries},i.prototype.toString=function(){return"["+this.entries.join(", ")+"]"},i.prototype.toJSON=function(){return{mathjs:"ResultSet",entries:this.entries}},i.fromJSON=function(e){return new i(e.entries)},i}t.name="ResultSet",t.path="type",t.factory=r},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("string",{"":function(){return""},number:a.format,"null":function(e){return"null"},"boolean":function(e){return e+""},string:function(e){return e},"Array | Matrix":function(e){return i(e,o)},any:function(e){return String(e)}});return o.toTex={0:'\\mathtt{""}',1:"\\mathrm{string}\\left(${args[0]}\\right)"},o}var i=r(19),a=r(6);t.name="string",t.factory=n},function(e,t,r){e.exports=[r(75),r(91),r(92)]},function(e,t,r){"use strict";function n(e,t,n,s,u){function c(e,t){if(!(this instanceof c))throw new Error("Constructor must be called with the new operator");if(void 0!==e&&!O(e)&&!e.isComplex)throw new TypeError("First parameter in Unit constructor must be number, BigNumber, Fraction, Complex, or undefined");if(void 0!=t&&("string"!=typeof t||""==t))throw new TypeError("Second parameter in Unit constructor must be a string");if(void 0!=t){var r=c.parse(t);this.units=r.units,this.dimensions=r.dimensions}else this.units=[{unit:F,prefix:P.NONE,power:0}],this.dimensions=[0,0,0,0,0,0,0,0,0];this.value=void 0!=e?this._normalize(e):null,this.fixPrefix=!1,this.isUnitListSimplified=!0}function f(){for(;" "==I||"	"==I;)h()}function l(e){return e>="0"&&"9">=e||"."==e}function p(e){return e>="0"&&"9">=e}function h(){k++,I=B.charAt(k)}function m(e){k=e,I=B.charAt(k)}function d(){var e,t="";if(e=k,"+"==I?h():"-"==I&&(t+=I,h()),!l(I))return m(e),null;if("."==I){if(t+=I,h(),!p(I))return m(e),null}else{for(;p(I);)t+=I,h();"."==I&&(t+=I,h())}for(;p(I);)t+=I,h();if("E"==I||"e"==I){var r="",n=k;if(r+=I,h(),"+"!=I&&"-"!=I||(r+=I,h()),!p(I))return m(n),t;for(t+=r;p(I);)t+=I,h()}return t}function g(){for(var e="",t=B.charCodeAt(k);t>=48&&57>=t||t>=65&&90>=t||t>=97&&122>=t;)e+=I,h(),t=B.charCodeAt(k);return t=e.charCodeAt(0),t>=65&&90>=t||t>=97&&122>=t?e||null:null}function v(e){return I===e?(h(),e):null}function y(e){for(var t in D)if(D.hasOwnProperty(t)&&i(e,t)){var r=D[t],n=e.length-t.length,a=e.substring(0,n),o=r.prefixes[a];if(void 0!==o)return{unit:r,prefix:o}}return null}function x(t){if("BigNumber"===t.number){var r=o.pi(e.BigNumber);D.rad.value=new e.BigNumber(1),D.deg.value=r.div(180),D.grad.value=r.div(200),D.cycle.value=r.times(2),D.arcsec.value=r.div(648e3),D.arcmin.value=r.div(10800)}else D.rad.value=1,D.deg.value=Math.PI/180,D.grad.value=Math.PI/200,D.cycle.value=2*Math.PI,D.arcsec.value=Math.PI/648e3,D.arcmin.value=Math.PI/10800}var b=n(r(53)),w=n(r(77)),N=n(r(80)),E=n(r(81)),M=n(r(82)),A=n(r(86)),_=n(r(87)),O=n(r(88)),T=n(r(89)),C=n(r(90)),S=n(r(70)),z=n(r(27));c.prototype.type="Unit",c.prototype.isUnit=!0;var B,k,I;c.parse=function(r){if(B=r,k=-1,I="","string"!=typeof B)throw new TypeError("Invalid argument in Unit.parse, string expected");var n=new c;n.units=[],h(),f();var i=d(),a=null;i&&(a="BigNumber"===t.number?new e.BigNumber(i):"Fraction"===t.number?new e.Fraction(i):parseFloat(i)),f();for(var o=1,s=!1,u=[],l=1;;){for(f();"("===I;)u.push(o),l*=o,o=1,h(),f();if(!I)break;var p=I,m=g();if(null==m)throw new SyntaxError('Unexpected "'+p+'" in "'+B+'" at index '+k.toString());var x=y(m);if(null==x)throw new SyntaxError('Unit "'+m+'" not found.');var b=o*l;if(f(),v("^")){f();var w=d();if(null==w)throw new SyntaxError('In "'+r+'", "^" must be followed by a floating-point number');b*=w}n.units.push({unit:x.unit,prefix:x.prefix,power:b});for(var N=0;N<q.length;N++)n.dimensions[N]+=x.unit.dimensions[N]*b;for(f();")"===I;){if(0===u.length)throw new SyntaxError('Unmatched ")" in "'+B+'" at index '+k.toString());l/=u.pop(),h(),f()}s=!1,v("*")?(o=1,s=!0):v("/")?(o=-1,s=!0):o=1;var E=x.unit.base.key;G.auto[E]={unit:x.unit,prefix:x.prefix}}if(f(),I)throw new SyntaxError('Could not parse: "'+r+'"');if(s)throw new SyntaxError('Trailing characters: "'+r+'"');if(0!==u.length)throw new SyntaxError('Unmatched "(" in "'+B+'"');if(0==n.units.length)throw new SyntaxError('"'+r+'" contains no units');return n.value=void 0!=a?n._normalize(a):null,n},c.prototype.clone=function(){var e=new c;e.fixPrefix=this.fixPrefix,e.isUnitListSimplified=this.isUnitListSimplified,e.value=a(this.value),e.dimensions=this.dimensions.slice(0),e.units=[];for(var t=0;t<this.units.length;t++){e.units[t]={};for(var r in this.units[t])this.units[t].hasOwnProperty(r)&&(e.units[t][r]=this.units[t][r])}return e},c.prototype._isDerived=function(){return 0===this.units.length?!1:this.units.length>1||Math.abs(this.units[0].power-1)>1e-15},c.prototype._normalize=function(e){var t,r,n,i,a;if(null==e||0===this.units.length)return e;if(this._isDerived()){var o=e;a=c._getNumberConverter(C(e));for(var s=0;s<this.units.length;s++)t=a(this.units[s].unit.value),i=a(this.units[s].prefix.value),n=a(this.units[s].power),o=N(o,M(N(t,i),n));return o}return a=c._getNumberConverter(C(e)),t=a(this.units[0].unit.value),r=a(this.units[0].unit.offset),i=a(this.units[0].prefix.value),N(b(e,r),N(t,i))},c.prototype._denormalize=function(e,t){var r,n,i,a,o;if(null==e||0===this.units.length)return e;if(this._isDerived()){var s=e;o=c._getNumberConverter(C(e));for(var u=0;u<this.units.length;u++)r=o(this.units[u].unit.value),a=o(this.units[u].prefix.value),i=o(this.units[u].power),s=E(s,M(N(r,a),i));return s}return o=c._getNumberConverter(C(e)),r=o(this.units[0].unit.value),a=o(this.units[0].prefix.value),n=o(this.units[0].unit.offset),void 0==t?w(E(E(e,r),a),n):w(E(E(e,r),t),n)},c.isValuelessUnit=function(e){return null!=y(e)},c.prototype.hasBase=function(e){if("string"==typeof e&&(e=L[e]),!e)return!1;for(var t=0;t<q.length;t++)if(Math.abs(this.dimensions[t]-e.dimensions[t])>1e-12)return!1;return!0},c.prototype.equalBase=function(e){for(var t=0;t<q.length;t++)if(Math.abs(this.dimensions[t]-e.dimensions[t])>1e-12)return!1;return!0},c.prototype.equals=function(e){return this.equalBase(e)&&_(this.value,e.value)},c.prototype.multiply=function(e){for(var t=this.clone(),r=0;r<q.length;r++)t.dimensions[r]=this.dimensions[r]+e.dimensions[r];for(var r=0;r<e.units.length;r++){var n=JSON.parse(JSON.stringify(e.units[r]));t.units.push(n)}if(null!=this.value||null!=e.value){var i=null==this.value?this._normalize(1):this.value,a=null==e.value?e._normalize(1):e.value;t.value=N(i,a)}else t.value=null;return t.isUnitListSimplified=!1,R(t)},c.prototype.divide=function(e){for(var t=this.clone(),r=0;r<q.length;r++)t.dimensions[r]=this.dimensions[r]-e.dimensions[r];for(var r=0;r<e.units.length;r++){var n=JSON.parse(JSON.stringify(e.units[r]));n.power=-n.power,t.units.push(n)}if(null!=this.value||null!=e.value){var i=null==this.value?this._normalize(1):this.value,a=null==e.value?e._normalize(1):e.value;t.value=E(i,a)}else t.value=null;return t.isUnitListSimplified=!1,R(t)},c.prototype.pow=function(e){for(var t=this.clone(),r=0;r<q.length;r++)t.dimensions[r]=this.dimensions[r]*e;for(var r=0;r<t.units.length;r++)t.units[r].power*=e;return null!=t.value?t.value=M(t.value,e):t.value=null,t.isUnitListSimplified=!1,R(t)};var R=function(e){return e.equalBase(L.NONE)&&null!==e.value&&!t.predictable?e.value:e};c.prototype.abs=function(){var e=this.clone();e.value=A(e.value);for(var t in e.units)"VA"!==e.units[t].unit.name&&"VAR"!==e.units[t].unit.name||(e.units[t].unit=D.W);return e},c.prototype.to=function(e){var t,r=null==this.value?this._normalize(1):this.value;if("string"==typeof e){if(t=c.parse(e),!this.equalBase(t))throw new Error("Units do not match");if(null!==t.value)throw new Error("Cannot convert to a unit with a value");return t.value=a(r),t.fixPrefix=!0,t.isUnitListSimplified=!0,t}if(e&&e.isUnit){if(!this.equalBase(e))throw new Error("Units do not match");if(null!==e.value)throw new Error("Cannot convert to a unit with a value");return t=e.clone(),t.value=a(r),t.fixPrefix=!0,t.isUnitListSimplified=!0,t}throw new Error("String or Unit expected as parameter")},c.prototype.toNumber=function(e){return S(this.toNumeric(e))},c.prototype.toNumeric=function(e){var t=this.to(e);return t._isDerived()?t._denormalize(t.value):t._denormalize(t.value,t.units[0].prefix.value)},c.prototype.toString=function(){return this.format()},c.prototype.toJSON=function(){return{mathjs:"Unit",value:this._denormalize(this.value),unit:this.formatUnits(),fixPrefix:this.fixPrefix}},c.fromJSON=function(e){var t=new c(e.value,e.unit);return t.fixPrefix=e.fixPrefix||!1,t},c.prototype.valueOf=c.prototype.toString,c.prototype.simplifyUnitListLazy=function(){if(!this.isUnitListSimplified&&null!=this.value){var e,t=[];for(var r in H)if(this.hasBase(L[r])){e=r;break}if("NONE"===e)this.units=[];else{var n;e&&H.hasOwnProperty(e)&&(n=H[e]);if(n)this.units=[{unit:n.unit,prefix:n.prefix,power:1}];else{for(var i=0;i<q.length;i++){var a=q[i];Math.abs(this.dimensions[i])>1e-12&&t.push({unit:H[a].unit,prefix:H[a].prefix,power:this.dimensions[i]})}t.length<this.units.length&&(this.units=t)}}this.isUnitListSimplified=!0}},c.prototype.formatUnits=function(){this.simplifyUnitListLazy();for(var e="",t="",r=0,n=0,i=0;i<this.units.length;i++)this.units[i].power>0?(r++,e+=" "+this.units[i].prefix.name+this.units[i].unit.name,Math.abs(this.units[i].power-1)>1e-15&&(e+="^"+this.units[i].power)):this.units[i].power<0&&n++;if(n>0)for(var i=0;i<this.units.length;i++)this.units[i].power<0&&(r>0?(t+=" "+this.units[i].prefix.name+this.units[i].unit.name,Math.abs(this.units[i].power+1)>1e-15&&(t+="^"+-this.units[i].power)):(t+=" "+this.units[i].prefix.name+this.units[i].unit.name,t+="^"+this.units[i].power));e=e.substr(1),t=t.substr(1),r>1&&n>0&&(e="("+e+")"),n>1&&r>0&&(t="("+t+")");var a=e;return r>0&&n>0&&(a+=" / "),a+=t},c.prototype.format=function(e){this.simplifyUnitListLazy();var t=!1,r=!0;"undefined"!=typeof this.value&&null!==this.value&&this.value.isComplex&&(t=Math.abs(this.value.re)<1e-14,r=Math.abs(this.value.im)<1e-14);for(var n in this.units)this.units[n].unit&&("VA"===this.units[n].unit.name&&t?this.units[n].unit=D.VAR:"VAR"!==this.units[n].unit.name||t||(this.units[n].unit=D.VA));1!==this.units.length||this.fixPrefix||Math.abs(this.units[0].power-Math.round(this.units[0].power))<1e-14&&(this.units[0].prefix=this._bestPrefix());var i=this._denormalize(this.value),a=null!==this.value?T(i,e||{}):"",o=this.formatUnits();return this.value&&this.value.isComplex&&(a="("+a+")"),o.length>0&&a.length>0&&(a+=" "),a+=o},c.prototype._bestPrefix=function(){if(1!==this.units.length)throw new Error("Can only compute the best prefix for single units with integer powers, like kg, s^2, N^-1, and so forth!");if(Math.abs(this.units[0].power-Math.round(this.units[0].power))>=1e-14)throw new Error("Can only compute the best prefix for single units with integer powers, like kg, s^2, N^-1, and so forth!");
var e=A(this.value),t=A(this.units[0].unit.value),r=this.units[0].prefix;if(0===e)return r;var n=this.units[0].power,i=Math.abs(Math.log(e/Math.pow(r.value*t,n))/Math.LN10-1.2),a=this.units[0].unit.prefixes;for(var o in a)if(a.hasOwnProperty(o)){var s=a[o];if(s.scientific){var u=Math.abs(Math.log(e/Math.pow(s.value*t,n))/Math.LN10-1.2);(i>u||u===i&&s.name.length<r.name.length)&&(r=s,i=u)}}return r};var P={NONE:{"":{name:"",value:1,scientific:!0}},SHORT:{"":{name:"",value:1,scientific:!0},da:{name:"da",value:10,scientific:!1},h:{name:"h",value:100,scientific:!1},k:{name:"k",value:1e3,scientific:!0},M:{name:"M",value:1e6,scientific:!0},G:{name:"G",value:1e9,scientific:!0},T:{name:"T",value:1e12,scientific:!0},P:{name:"P",value:1e15,scientific:!0},E:{name:"E",value:1e18,scientific:!0},Z:{name:"Z",value:1e21,scientific:!0},Y:{name:"Y",value:1e24,scientific:!0},d:{name:"d",value:.1,scientific:!1},c:{name:"c",value:.01,scientific:!1},m:{name:"m",value:.001,scientific:!0},u:{name:"u",value:1e-6,scientific:!0},n:{name:"n",value:1e-9,scientific:!0},p:{name:"p",value:1e-12,scientific:!0},f:{name:"f",value:1e-15,scientific:!0},a:{name:"a",value:1e-18,scientific:!0},z:{name:"z",value:1e-21,scientific:!0},y:{name:"y",value:1e-24,scientific:!0}},LONG:{"":{name:"",value:1,scientific:!0},deca:{name:"deca",value:10,scientific:!1},hecto:{name:"hecto",value:100,scientific:!1},kilo:{name:"kilo",value:1e3,scientific:!0},mega:{name:"mega",value:1e6,scientific:!0},giga:{name:"giga",value:1e9,scientific:!0},tera:{name:"tera",value:1e12,scientific:!0},peta:{name:"peta",value:1e15,scientific:!0},exa:{name:"exa",value:1e18,scientific:!0},zetta:{name:"zetta",value:1e21,scientific:!0},yotta:{name:"yotta",value:1e24,scientific:!0},deci:{name:"deci",value:.1,scientific:!1},centi:{name:"centi",value:.01,scientific:!1},milli:{name:"milli",value:.001,scientific:!0},micro:{name:"micro",value:1e-6,scientific:!0},nano:{name:"nano",value:1e-9,scientific:!0},pico:{name:"pico",value:1e-12,scientific:!0},femto:{name:"femto",value:1e-15,scientific:!0},atto:{name:"atto",value:1e-18,scientific:!0},zepto:{name:"zepto",value:1e-21,scientific:!0},yocto:{name:"yocto",value:1e-24,scientific:!0}},SQUARED:{"":{name:"",value:1,scientific:!0},da:{name:"da",value:100,scientific:!1},h:{name:"h",value:1e4,scientific:!1},k:{name:"k",value:1e6,scientific:!0},M:{name:"M",value:1e12,scientific:!0},G:{name:"G",value:1e18,scientific:!0},T:{name:"T",value:1e24,scientific:!0},P:{name:"P",value:1e30,scientific:!0},E:{name:"E",value:1e36,scientific:!0},Z:{name:"Z",value:1e42,scientific:!0},Y:{name:"Y",value:1e48,scientific:!0},d:{name:"d",value:.01,scientific:!1},c:{name:"c",value:1e-4,scientific:!1},m:{name:"m",value:1e-6,scientific:!0},u:{name:"u",value:1e-12,scientific:!0},n:{name:"n",value:1e-18,scientific:!0},p:{name:"p",value:1e-24,scientific:!0},f:{name:"f",value:1e-30,scientific:!0},a:{name:"a",value:1e-36,scientific:!0},z:{name:"z",value:1e-42,scientific:!0},y:{name:"y",value:1e-48,scientific:!0}},CUBIC:{"":{name:"",value:1,scientific:!0},da:{name:"da",value:1e3,scientific:!1},h:{name:"h",value:1e6,scientific:!1},k:{name:"k",value:1e9,scientific:!0},M:{name:"M",value:1e18,scientific:!0},G:{name:"G",value:1e27,scientific:!0},T:{name:"T",value:1e36,scientific:!0},P:{name:"P",value:1e45,scientific:!0},E:{name:"E",value:1e54,scientific:!0},Z:{name:"Z",value:1e63,scientific:!0},Y:{name:"Y",value:1e72,scientific:!0},d:{name:"d",value:.001,scientific:!1},c:{name:"c",value:1e-6,scientific:!1},m:{name:"m",value:1e-9,scientific:!0},u:{name:"u",value:1e-18,scientific:!0},n:{name:"n",value:1e-27,scientific:!0},p:{name:"p",value:1e-36,scientific:!0},f:{name:"f",value:1e-45,scientific:!0},a:{name:"a",value:1e-54,scientific:!0},z:{name:"z",value:1e-63,scientific:!0},y:{name:"y",value:1e-72,scientific:!0}},BINARY_SHORT:{"":{name:"",value:1,scientific:!0},k:{name:"k",value:1e3,scientific:!0},M:{name:"M",value:1e6,scientific:!0},G:{name:"G",value:1e9,scientific:!0},T:{name:"T",value:1e12,scientific:!0},P:{name:"P",value:1e15,scientific:!0},E:{name:"E",value:1e18,scientific:!0},Z:{name:"Z",value:1e21,scientific:!0},Y:{name:"Y",value:1e24,scientific:!0},Ki:{name:"Ki",value:1024,scientific:!0},Mi:{name:"Mi",value:Math.pow(1024,2),scientific:!0},Gi:{name:"Gi",value:Math.pow(1024,3),scientific:!0},Ti:{name:"Ti",value:Math.pow(1024,4),scientific:!0},Pi:{name:"Pi",value:Math.pow(1024,5),scientific:!0},Ei:{name:"Ei",value:Math.pow(1024,6),scientific:!0},Zi:{name:"Zi",value:Math.pow(1024,7),scientific:!0},Yi:{name:"Yi",value:Math.pow(1024,8),scientific:!0}},BINARY_LONG:{"":{name:"",value:1,scientific:!0},kilo:{name:"kilo",value:1e3,scientific:!0},mega:{name:"mega",value:1e6,scientific:!0},giga:{name:"giga",value:1e9,scientific:!0},tera:{name:"tera",value:1e12,scientific:!0},peta:{name:"peta",value:1e15,scientific:!0},exa:{name:"exa",value:1e18,scientific:!0},zetta:{name:"zetta",value:1e21,scientific:!0},yotta:{name:"yotta",value:1e24,scientific:!0},kibi:{name:"kibi",value:1024,scientific:!0},mebi:{name:"mebi",value:Math.pow(1024,2),scientific:!0},gibi:{name:"gibi",value:Math.pow(1024,3),scientific:!0},tebi:{name:"tebi",value:Math.pow(1024,4),scientific:!0},pebi:{name:"pebi",value:Math.pow(1024,5),scientific:!0},exi:{name:"exi",value:Math.pow(1024,6),scientific:!0},zebi:{name:"zebi",value:Math.pow(1024,7),scientific:!0},yobi:{name:"yobi",value:Math.pow(1024,8),scientific:!0}},BTU:{"":{name:"",value:1,scientific:!0},MM:{name:"MM",value:1e6,scientific:!0}}};P.SHORTLONG={};for(var U in P.SHORT)P.SHORT.hasOwnProperty(U)&&(P.SHORTLONG[U]=P.SHORT[U]);for(var U in P.LONG)P.LONG.hasOwnProperty(U)&&(P.SHORTLONG[U]=P.LONG[U]);var q=["MASS","LENGTH","TIME","CURRENT","TEMPERATURE","LUMINOUS_INTENSITY","AMOUNT_OF_SUBSTANCE","ANGLE","BIT"],L={NONE:{dimensions:[0,0,0,0,0,0,0,0,0]},MASS:{dimensions:[1,0,0,0,0,0,0,0,0]},LENGTH:{dimensions:[0,1,0,0,0,0,0,0,0]},TIME:{dimensions:[0,0,1,0,0,0,0,0,0]},CURRENT:{dimensions:[0,0,0,1,0,0,0,0,0]},TEMPERATURE:{dimensions:[0,0,0,0,1,0,0,0,0]},LUMINOUS_INTENSITY:{dimensions:[0,0,0,0,0,1,0,0,0]},AMOUNT_OF_SUBSTANCE:{dimensions:[0,0,0,0,0,0,1,0,0]},FORCE:{dimensions:[1,1,-2,0,0,0,0,0,0]},SURFACE:{dimensions:[0,2,0,0,0,0,0,0,0]},VOLUME:{dimensions:[0,3,0,0,0,0,0,0,0]},ENERGY:{dimensions:[1,2,-2,0,0,0,0,0,0]},POWER:{dimensions:[1,2,-3,0,0,0,0,0,0]},PRESSURE:{dimensions:[1,-1,-2,0,0,0,0,0,0]},ELECTRIC_CHARGE:{dimensions:[0,0,1,1,0,0,0,0,0]},ELECTRIC_CAPACITANCE:{dimensions:[-1,-2,4,2,0,0,0,0,0]},ELECTRIC_POTENTIAL:{dimensions:[1,2,-3,-1,0,0,0,0,0]},ELECTRIC_RESISTANCE:{dimensions:[1,2,-3,-2,0,0,0,0,0]},ELECTRIC_INDUCTANCE:{dimensions:[1,2,-2,-2,0,0,0,0,0]},ELECTRIC_CONDUCTANCE:{dimensions:[-1,-2,3,2,0,0,0,0,0]},MAGNETIC_FLUX:{dimensions:[1,2,-2,-1,0,0,0,0,0]},MAGNETIC_FLUX_DENSITY:{dimensions:[1,0,-2,-1,0,0,0,0,0]},FREQUENCY:{dimensions:[0,0,-1,0,0,0,0,0,0]},ANGLE:{dimensions:[0,0,0,0,0,0,0,1,0]},BIT:{dimensions:[0,0,0,0,0,0,0,0,1]}};for(var U in L)L[U].key=U;var j={},F={name:"",base:j,value:1,offset:0,dimensions:[0,0,0,0,0,0,0,0,0]},D={meter:{name:"meter",base:L.LENGTH,prefixes:P.LONG,value:1,offset:0},inch:{name:"inch",base:L.LENGTH,prefixes:P.NONE,value:.0254,offset:0},foot:{name:"foot",base:L.LENGTH,prefixes:P.NONE,value:.3048,offset:0},yard:{name:"yard",base:L.LENGTH,prefixes:P.NONE,value:.9144,offset:0},mile:{name:"mile",base:L.LENGTH,prefixes:P.NONE,value:1609.344,offset:0},link:{name:"link",base:L.LENGTH,prefixes:P.NONE,value:.201168,offset:0},rod:{name:"rod",base:L.LENGTH,prefixes:P.NONE,value:5.02921,offset:0},chain:{name:"chain",base:L.LENGTH,prefixes:P.NONE,value:20.1168,offset:0},angstrom:{name:"angstrom",base:L.LENGTH,prefixes:P.NONE,value:1e-10,offset:0},m:{name:"m",base:L.LENGTH,prefixes:P.SHORT,value:1,offset:0},"in":{name:"in",base:L.LENGTH,prefixes:P.NONE,value:.0254,offset:0},ft:{name:"ft",base:L.LENGTH,prefixes:P.NONE,value:.3048,offset:0},yd:{name:"yd",base:L.LENGTH,prefixes:P.NONE,value:.9144,offset:0},mi:{name:"mi",base:L.LENGTH,prefixes:P.NONE,value:1609.344,offset:0},li:{name:"li",base:L.LENGTH,prefixes:P.NONE,value:.201168,offset:0},rd:{name:"rd",base:L.LENGTH,prefixes:P.NONE,value:5.02921,offset:0},ch:{name:"ch",base:L.LENGTH,prefixes:P.NONE,value:20.1168,offset:0},mil:{name:"mil",base:L.LENGTH,prefixes:P.NONE,value:254e-7,offset:0},m2:{name:"m2",base:L.SURFACE,prefixes:P.SQUARED,value:1,offset:0},sqin:{name:"sqin",base:L.SURFACE,prefixes:P.NONE,value:64516e-8,offset:0},sqft:{name:"sqft",base:L.SURFACE,prefixes:P.NONE,value:.09290304,offset:0},sqyd:{name:"sqyd",base:L.SURFACE,prefixes:P.NONE,value:.83612736,offset:0},sqmi:{name:"sqmi",base:L.SURFACE,prefixes:P.NONE,value:2589988.110336,offset:0},sqrd:{name:"sqrd",base:L.SURFACE,prefixes:P.NONE,value:25.29295,offset:0},sqch:{name:"sqch",base:L.SURFACE,prefixes:P.NONE,value:404.6873,offset:0},sqmil:{name:"sqmil",base:L.SURFACE,prefixes:P.NONE,value:6.4516e-10,offset:0},acre:{name:"acre",base:L.SURFACE,prefixes:P.NONE,value:4046.86,offset:0},hectare:{name:"hectare",base:L.SURFACE,prefixes:P.NONE,value:1e4,offset:0},m3:{name:"m3",base:L.VOLUME,prefixes:P.CUBIC,value:1,offset:0},L:{name:"L",base:L.VOLUME,prefixes:P.SHORT,value:.001,offset:0},l:{name:"l",base:L.VOLUME,prefixes:P.SHORT,value:.001,offset:0},litre:{name:"litre",base:L.VOLUME,prefixes:P.LONG,value:.001,offset:0},cuin:{name:"cuin",base:L.VOLUME,prefixes:P.NONE,value:16387064e-12,offset:0},cuft:{name:"cuft",base:L.VOLUME,prefixes:P.NONE,value:.028316846592,offset:0},cuyd:{name:"cuyd",base:L.VOLUME,prefixes:P.NONE,value:.764554857984,offset:0},teaspoon:{name:"teaspoon",base:L.VOLUME,prefixes:P.NONE,value:5e-6,offset:0},tablespoon:{name:"tablespoon",base:L.VOLUME,prefixes:P.NONE,value:15e-6,offset:0},drop:{name:"drop",base:L.VOLUME,prefixes:P.NONE,value:5e-8,offset:0},gtt:{name:"gtt",base:L.VOLUME,prefixes:P.NONE,value:5e-8,offset:0},minim:{name:"minim",base:L.VOLUME,prefixes:P.NONE,value:6.161152e-8,offset:0},fluiddram:{name:"fluiddram",base:L.VOLUME,prefixes:P.NONE,value:36966911e-13,offset:0},fluidounce:{name:"fluidounce",base:L.VOLUME,prefixes:P.NONE,value:2957353e-11,offset:0},gill:{name:"gill",base:L.VOLUME,prefixes:P.NONE,value:.0001182941,offset:0},cc:{name:"cc",base:L.VOLUME,prefixes:P.NONE,value:1e-6,offset:0},cup:{name:"cup",base:L.VOLUME,prefixes:P.NONE,value:.0002365882,offset:0},pint:{name:"pint",base:L.VOLUME,prefixes:P.NONE,value:.0004731765,offset:0},quart:{name:"quart",base:L.VOLUME,prefixes:P.NONE,value:.0009463529,offset:0},gallon:{name:"gallon",base:L.VOLUME,prefixes:P.NONE,value:.003785412,offset:0},beerbarrel:{name:"beerbarrel",base:L.VOLUME,prefixes:P.NONE,value:.1173478,offset:0},oilbarrel:{name:"oilbarrel",base:L.VOLUME,prefixes:P.NONE,value:.1589873,offset:0},hogshead:{name:"hogshead",base:L.VOLUME,prefixes:P.NONE,value:.238481,offset:0},fldr:{name:"fldr",base:L.VOLUME,prefixes:P.NONE,value:36966911e-13,offset:0},floz:{name:"floz",base:L.VOLUME,prefixes:P.NONE,value:2957353e-11,offset:0},gi:{name:"gi",base:L.VOLUME,prefixes:P.NONE,value:.0001182941,offset:0},cp:{name:"cp",base:L.VOLUME,prefixes:P.NONE,value:.0002365882,offset:0},pt:{name:"pt",base:L.VOLUME,prefixes:P.NONE,value:.0004731765,offset:0},qt:{name:"qt",base:L.VOLUME,prefixes:P.NONE,value:.0009463529,offset:0},gal:{name:"gal",base:L.VOLUME,prefixes:P.NONE,value:.003785412,offset:0},bbl:{name:"bbl",base:L.VOLUME,prefixes:P.NONE,value:.1173478,offset:0},obl:{name:"obl",base:L.VOLUME,prefixes:P.NONE,value:.1589873,offset:0},g:{name:"g",base:L.MASS,prefixes:P.SHORT,value:.001,offset:0},gram:{name:"gram",base:L.MASS,prefixes:P.LONG,value:.001,offset:0},ton:{name:"ton",base:L.MASS,prefixes:P.SHORT,value:907.18474,offset:0},tonne:{name:"tonne",base:L.MASS,prefixes:P.SHORT,value:1e3,offset:0},grain:{name:"grain",base:L.MASS,prefixes:P.NONE,value:6479891e-11,offset:0},dram:{name:"dram",base:L.MASS,prefixes:P.NONE,value:.0017718451953125,offset:0},ounce:{name:"ounce",base:L.MASS,prefixes:P.NONE,value:.028349523125,offset:0},poundmass:{name:"poundmass",base:L.MASS,prefixes:P.NONE,value:.45359237,offset:0},hundredweight:{name:"hundredweight",base:L.MASS,prefixes:P.NONE,value:45.359237,offset:0},stick:{name:"stick",base:L.MASS,prefixes:P.NONE,value:.115,offset:0},stone:{name:"stone",base:L.MASS,prefixes:P.NONE,value:6.35029318,offset:0},gr:{name:"gr",base:L.MASS,prefixes:P.NONE,value:6479891e-11,offset:0},dr:{name:"dr",base:L.MASS,prefixes:P.NONE,value:.0017718451953125,offset:0},oz:{name:"oz",base:L.MASS,prefixes:P.NONE,value:.028349523125,offset:0},lbm:{name:"lbm",base:L.MASS,prefixes:P.NONE,value:.45359237,offset:0},cwt:{name:"cwt",base:L.MASS,prefixes:P.NONE,value:45.359237,offset:0},s:{name:"s",base:L.TIME,prefixes:P.SHORT,value:1,offset:0},min:{name:"min",base:L.TIME,prefixes:P.NONE,value:60,offset:0},h:{name:"h",base:L.TIME,prefixes:P.NONE,value:3600,offset:0},second:{name:"second",base:L.TIME,prefixes:P.LONG,value:1,offset:0},sec:{name:"sec",base:L.TIME,prefixes:P.LONG,value:1,offset:0},minute:{name:"minute",base:L.TIME,prefixes:P.NONE,value:60,offset:0},hour:{name:"hour",base:L.TIME,prefixes:P.NONE,value:3600,offset:0},day:{name:"day",base:L.TIME,prefixes:P.NONE,value:86400,offset:0},week:{name:"week",base:L.TIME,prefixes:P.NONE,value:604800,offset:0},month:{name:"month",base:L.TIME,prefixes:P.NONE,value:2629800,offset:0},year:{name:"year",base:L.TIME,prefixes:P.NONE,value:31557600,offset:0},decade:{name:"year",base:L.TIME,prefixes:P.NONE,value:315576e3,offset:0},century:{name:"century",base:L.TIME,prefixes:P.NONE,value:315576e4,offset:0},millennium:{name:"millennium",base:L.TIME,prefixes:P.NONE,value:315576e5,offset:0},hertz:{name:"Hertz",base:L.FREQUENCY,prefixes:P.LONG,value:1,offset:0,reciprocal:!0},Hz:{name:"Hz",base:L.FREQUENCY,prefixes:P.SHORT,value:1,offset:0,reciprocal:!0},rad:{name:"rad",base:L.ANGLE,prefixes:P.NONE,value:1,offset:0},deg:{name:"deg",base:L.ANGLE,prefixes:P.NONE,value:null,offset:0},grad:{name:"grad",base:L.ANGLE,prefixes:P.NONE,value:null,offset:0},cycle:{name:"cycle",base:L.ANGLE,prefixes:P.NONE,value:null,offset:0},arcsec:{name:"arcsec",base:L.ANGLE,prefixes:P.NONE,value:null,offset:0},arcmin:{name:"arcmin",base:L.ANGLE,prefixes:P.NONE,value:null,offset:0},A:{name:"A",base:L.CURRENT,prefixes:P.SHORT,value:1,offset:0},ampere:{name:"ampere",base:L.CURRENT,prefixes:P.LONG,value:1,offset:0},K:{name:"K",base:L.TEMPERATURE,prefixes:P.NONE,value:1,offset:0},degC:{name:"degC",base:L.TEMPERATURE,prefixes:P.NONE,value:1,offset:273.15},degF:{name:"degF",base:L.TEMPERATURE,prefixes:P.NONE,value:1/1.8,offset:459.67},degR:{name:"degR",base:L.TEMPERATURE,prefixes:P.NONE,value:1/1.8,offset:0},kelvin:{name:"kelvin",base:L.TEMPERATURE,prefixes:P.NONE,value:1,offset:0},celsius:{name:"celsius",base:L.TEMPERATURE,prefixes:P.NONE,value:1,offset:273.15},fahrenheit:{name:"fahrenheit",base:L.TEMPERATURE,prefixes:P.NONE,value:1/1.8,offset:459.67},rankine:{name:"rankine",base:L.TEMPERATURE,prefixes:P.NONE,value:1/1.8,offset:0},mol:{name:"mol",base:L.AMOUNT_OF_SUBSTANCE,prefixes:P.SHORT,value:1,offset:0},mole:{name:"mole",base:L.AMOUNT_OF_SUBSTANCE,prefixes:P.LONG,value:1,offset:0},cd:{name:"cd",base:L.LUMINOUS_INTENSITY,prefixes:P.NONE,value:1,offset:0},candela:{name:"candela",base:L.LUMINOUS_INTENSITY,prefixes:P.NONE,value:1,offset:0},N:{name:"N",base:L.FORCE,prefixes:P.SHORT,value:1,offset:0},newton:{name:"newton",base:L.FORCE,prefixes:P.LONG,value:1,offset:0},dyn:{name:"dyn",base:L.FORCE,prefixes:P.SHORT,value:1e-5,offset:0},dyne:{name:"dyne",base:L.FORCE,prefixes:P.LONG,value:1e-5,offset:0},lbf:{name:"lbf",base:L.FORCE,prefixes:P.NONE,value:4.4482216152605,offset:0},poundforce:{name:"poundforce",base:L.FORCE,prefixes:P.NONE,value:4.4482216152605,offset:0},kip:{name:"kip",base:L.FORCE,prefixes:P.LONG,value:4448.2216,offset:0},J:{name:"J",base:L.ENERGY,prefixes:P.SHORT,value:1,offset:0},joule:{name:"joule",base:L.ENERGY,prefixes:P.SHORT,value:1,offset:0},erg:{name:"erg",base:L.ENERGY,prefixes:P.NONE,value:1e-5,offset:0},Wh:{name:"Wh",base:L.ENERGY,prefixes:P.SHORT,value:3600,offset:0},BTU:{name:"BTU",base:L.ENERGY,prefixes:P.BTU,value:1055.05585262,offset:0},eV:{name:"eV",base:L.ENERGY,prefixes:P.SHORT,value:1.602176565e-19,offset:0},electronvolt:{name:"electronvolt",base:L.ENERGY,prefixes:P.LONG,value:1.602176565e-19,offset:0},W:{name:"W",base:L.POWER,prefixes:P.SHORT,value:1,offset:0},watt:{name:"W",base:L.POWER,prefixes:P.LONG,value:1,offset:0},hp:{name:"hp",base:L.POWER,prefixes:P.NONE,value:745.6998715386,offset:0},VAR:{name:"VAR",base:L.POWER,prefixes:P.SHORT,value:z.I,offset:0},VA:{name:"VA",base:L.POWER,prefixes:P.SHORT,value:1,offset:0},Pa:{name:"Pa",base:L.PRESSURE,prefixes:P.SHORT,value:1,offset:0},psi:{name:"psi",base:L.PRESSURE,prefixes:P.NONE,value:6894.75729276459,offset:0},atm:{name:"atm",base:L.PRESSURE,prefixes:P.NONE,value:101325,offset:0},bar:{name:"bar",base:L.PRESSURE,prefixes:P.NONE,value:1e5,offset:0},torr:{name:"torr",base:L.PRESSURE,prefixes:P.NONE,value:133.322,offset:0},mmHg:{name:"mmHg",base:L.PRESSURE,prefixes:P.NONE,value:133.322,offset:0},mmH2O:{name:"mmH2O",base:L.PRESSURE,prefixes:P.NONE,value:9.80665,offset:0},cmH2O:{name:"cmH2O",base:L.PRESSURE,prefixes:P.NONE,value:98.0665,offset:0},coulomb:{name:"coulomb",base:L.ELECTRIC_CHARGE,prefixes:P.LONG,value:1,offset:0},C:{name:"C",base:L.ELECTRIC_CHARGE,prefixes:P.SHORT,value:1,offset:0},farad:{name:"farad",base:L.ELECTRIC_CAPACITANCE,prefixes:P.LONG,value:1,offset:0},F:{name:"F",base:L.ELECTRIC_CAPACITANCE,prefixes:P.SHORT,value:1,offset:0},volt:{name:"volt",base:L.ELECTRIC_POTENTIAL,prefixes:P.LONG,value:1,offset:0},V:{name:"V",base:L.ELECTRIC_POTENTIAL,prefixes:P.SHORT,value:1,offset:0},ohm:{name:"ohm",base:L.ELECTRIC_RESISTANCE,prefixes:P.SHORTLONG,value:1,offset:0},henry:{name:"henry",base:L.ELECTRIC_INDUCTANCE,prefixes:P.LONG,value:1,offset:0},H:{name:"H",base:L.ELECTRIC_INDUCTANCE,prefixes:P.SHORT,value:1,offset:0},siemens:{name:"siemens",base:L.ELECTRIC_CONDUCTANCE,prefixes:P.LONG,value:1,offset:0},S:{name:"S",base:L.ELECTRIC_CONDUCTANCE,prefixes:P.SHORT,value:1,offset:0},weber:{name:"weber",base:L.MAGNETIC_FLUX,prefixes:P.LONG,value:1,offset:0},Wb:{name:"Wb",base:L.MAGNETIC_FLUX,prefixes:P.SHORT,value:1,offset:0},tesla:{name:"tesla",base:L.MAGNETIC_FLUX_DENSITY,prefixes:P.LONG,value:1,offset:0},T:{name:"T",base:L.MAGNETIC_FLUX_DENSITY,prefixes:P.SHORT,value:1,offset:0},b:{name:"b",base:L.BIT,prefixes:P.BINARY_SHORT,value:1,offset:0},bits:{name:"bits",base:L.BIT,prefixes:P.BINARY_LONG,value:1,offset:0},B:{name:"B",base:L.BIT,prefixes:P.BINARY_SHORT,value:8,offset:0},bytes:{name:"bytes",base:L.BIT,prefixes:P.BINARY_LONG,value:8,offset:0}},$={meters:"meter",inches:"inch",feet:"foot",yards:"yard",miles:"mile",links:"link",rods:"rod",chains:"chain",angstroms:"angstrom",lt:"l",litres:"litre",liter:"litre",liters:"litre",teaspoons:"teaspoon",tablespoons:"tablespoon",minims:"minim",fluiddrams:"fluiddram",fluidounces:"fluidounce",gills:"gill",cups:"cup",pints:"pint",quarts:"quart",gallons:"gallon",beerbarrels:"beerbarrel",oilbarrels:"oilbarrel",hogsheads:"hogshead",gtts:"gtt",grams:"gram",tons:"ton",tonnes:"tonne",grains:"grain",drams:"dram",ounces:"ounce",poundmasses:"poundmass",hundredweights:"hundredweight",sticks:"stick",lb:"lbm",lbs:"lbm",kips:"kip",acres:"acre",hectares:"hectare",sqfeet:"sqft",sqyard:"sqyd",sqmile:"sqmi",sqmiles:"sqmi",mmhg:"mmHg",mmh2o:"mmH2O",cmh2o:"cmH2O",seconds:"second",secs:"second",minutes:"minute",mins:"minute",hours:"hour",hr:"hour",hrs:"hour",days:"day",weeks:"week",months:"month",years:"year",hertz:"hertz",radians:"rad",degree:"deg",degrees:"deg",gradian:"grad",gradians:"grad",cycles:"cycle",arcsecond:"arcsec",arcseconds:"arcsec",arcminute:"arcmin",arcminutes:"arcmin",BTUs:"BTU",watts:"watt",joules:"joule",amperes:"ampere",coulombs:"coulomb",volts:"volt",ohms:"ohm",farads:"farad",webers:"weber",teslas:"tesla",electronvolts:"electronvolt",moles:"mole"};x(t),u.on("config",function(e,t){e.number!==t.number&&x(e)});var G={si:{NONE:{unit:F,prefix:P.NONE[""]},LENGTH:{unit:D.m,prefix:P.SHORT[""]},MASS:{unit:D.g,prefix:P.SHORT.k},TIME:{unit:D.s,prefix:P.SHORT[""]},CURRENT:{unit:D.A,prefix:P.SHORT[""]},TEMPERATURE:{unit:D.K,prefix:P.SHORT[""]},LUMINOUS_INTENSITY:{unit:D.cd,prefix:P.SHORT[""]},AMOUNT_OF_SUBSTANCE:{unit:D.mol,prefix:P.SHORT[""]},ANGLE:{unit:D.rad,prefix:P.SHORT[""]},BIT:{unit:D.bit,prefix:P.SHORT[""]},FORCE:{unit:D.N,prefix:P.SHORT[""]},ENERGY:{unit:D.J,prefix:P.SHORT[""]},POWER:{unit:D.W,prefix:P.SHORT[""]},PRESSURE:{unit:D.Pa,prefix:P.SHORT[""]},ELECTRIC_CHARGE:{unit:D.C,prefix:P.SHORT[""]},ELECTRIC_CAPACITANCE:{unit:D.F,prefix:P.SHORT[""]},ELECTRIC_POTENTIAL:{unit:D.V,prefix:P.SHORT[""]},ELECTRIC_RESISTANCE:{unit:D.ohm,prefix:P.SHORT[""]},ELECTRIC_INDUCTANCE:{unit:D.H,prefix:P.SHORT[""]},ELECTRIC_CONDUCTANCE:{unit:D.S,prefix:P.SHORT[""]},MAGNETIC_FLUX:{unit:D.Wb,prefix:P.SHORT[""]},MAGNETIC_FLUX_DENSITY:{unit:D.T,prefix:P.SHORT[""]},FREQUENCY:{unit:D.Hz,prefix:P.SHORT[""]}}};G.cgs=JSON.parse(JSON.stringify(G.si)),G.cgs.LENGTH={unit:D.m,prefix:P.SHORT.c},G.cgs.MASS={unit:D.g,prefix:P.SHORT[""]},G.cgs.FORCE={unit:D.dyn,prefix:P.SHORT[""]},G.cgs.ENERGY={unit:D.erg,prefix:P.NONE[""]},G.us=JSON.parse(JSON.stringify(G.si)),G.us.LENGTH={unit:D.ft,prefix:P.NONE[""]},G.us.MASS={unit:D.lbm,prefix:P.NONE[""]},G.us.TEMPERATURE={unit:D.degF,prefix:P.NONE[""]},G.us.FORCE={unit:D.lbf,prefix:P.NONE[""]},G.us.ENERGY={unit:D.BTU,prefix:P.BTU[""]},G.us.POWER={unit:D.hp,prefix:P.NONE[""]},G.us.PRESSURE={unit:D.psi,prefix:P.NONE[""]},G.auto=JSON.parse(JSON.stringify(G.si));var H=G.auto;c.setUnitSystem=function(e){if(!G.hasOwnProperty(e))throw new Error("Unit system "+e+" does not exist. Choices are: "+Object.keys(G).join(", "));H=G[e]},c.getUnitSystem=function(){for(var e in G)if(G[e]===H)return e},c.typeConverters={BigNumber:function(t){return new e.BigNumber(t+"")},Fraction:function(t){return new e.Fraction(t)},Complex:function(e){return e},number:function(e){return e}},c._getNumberConverter=function(e){if(!c.typeConverters[e])throw new TypeError('Unsupported type "'+e+'"');return c.typeConverters[e]};for(var U in D){var V=D[U];V.dimensions=V.base.dimensions}for(var Z in $)if($.hasOwnProperty(Z)){var V=D[$[Z]],W=Object.create(V);W.name=Z,D[Z]=W}return c.PREFIXES=P,c.BASE_UNITS=L,c.UNITS=D,c.UNIT_SYSTEMS=G,c}var i=r(23).endsWith,a=r(3).clone,o=r(76);t.name="Unit",t.path="type",t.factory=n,t.math=!0},function(e,t,r){function n(e){return e[0].precision}var i=r(45).memoize;t.e=i(function(e){return new e(1).exp()},n),t.phi=i(function(e){return new e(1).plus(new e(5).sqrt()).div(2)},n),t.pi=i(function(e){return pi=e.acos(-1)},n),t.tau=i(function(e){return t.pi(e).times(2)},n)},function(e,t,r){"use strict";function n(e,t,n,a){var o=r(32),s=n(r(52)),u=n(r(53)),c=n(r(78)),f=n(r(54)),l=n(r(61)),p=n(r(79)),h=n(r(56)),m=n(r(57)),d=n(r(58)),g=a("subtract",{"number, number":function(e,t){return e-t},"Complex, Complex":function(e,t){return e.sub(t)},"BigNumber, BigNumber":function(e,t){return e.minus(t)},"Fraction, Fraction":function(e,t){return e.sub(t)},"Unit, Unit":function(e,t){if(null==e.value)throw new Error("Parameter x contains a unit with undefined value");if(null==t.value)throw new Error("Parameter y contains a unit with undefined value");if(!e.equalBase(t))throw new Error("Units do not match");var r=e.clone();return r.value=g(r.value,t.value),r.fixPrefix=!1,r},"Matrix, Matrix":function(e,t){var r=e.size(),n=t.size();if(r.length!==n.length)throw new i(r.length,n.length);var a;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":a=p(e,t,g);break;default:a=l(t,e,g,!0)}break;default:switch(t.storage()){case"sparse":a=f(e,t,g,!1);break;default:a=m(e,t,g)}}return a},"Array, Array":function(e,t){return g(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return g(s(e),t)},"Matrix, Array":function(e,t){return g(e,s(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=h(e,c(t),u);break;default:r=d(e,t,g)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=h(t,e,g,!0);break;default:r=d(t,e,g,!0)}return r},"Array, any":function(e,t){return d(s(e),t,g,!1).valueOf()},"any, Array":function(e,t){return d(s(t),e,g,!0).valueOf()}});return g.toTex={2:"\\left(${args[0]}"+o.operators.subtract+"${args[1]}\\right)"},g}var i=r(42);t.name="subtract",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=r(32),s=a("unaryMinus",{number:function(e){return-e},Complex:function(e){return e.neg()},BigNumber:function(e){return e.neg()},Fraction:function(e){return e.neg()},Unit:function(e){var t=e.clone();return t.value=s(e.value),t},"Array | Matrix":function(e){return i(e,s,!0)}});return s.toTex={1:o.operators.unaryMinus+"\\left(${args[0]}\\right)"},s}var i=r(19);t.name="unaryMinus",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(48)),s=e.SparseMatrix,u=function(e,t,r){var n=e._values,u=e._index,c=e._ptr,f=e._size,l=e._datatype,p=t._values,h=t._index,m=t._ptr,d=t._size,g=t._datatype;if(f.length!==d.length)throw new i(f.length,d.length);if(f[0]!==d[0]||f[1]!==d[1])throw new RangeError("Dimension mismatch. Matrix A ("+f+") must match Matrix B ("+d+")");var v,y=f[0],x=f[1],b=o,w=0,N=r;"string"==typeof l&&l===g&&(v=l,b=a.find(o,[v,v]),w=a.convert(0,v),N=a.find(r,[v,v]));var E,M,A,_,O=n&&p?[]:void 0,T=[],C=[],S=new s({values:O,index:T,ptr:C,size:[y,x],datatype:v}),z=O?[]:void 0,B=O?[]:void 0,k=[],I=[];for(M=0;x>M;M++){C[M]=T.length;var R=M+1;for(A=c[M],_=c[M+1];_>A;A++)E=u[A],T.push(E),k[E]=R,z&&(z[E]=n[A]);for(A=m[M],_=m[M+1];_>A;A++)E=h[A],k[E]!==R&&T.push(E),I[E]=R,B&&(B[E]=p[A]);if(O)for(A=C[M];A<T.length;){E=T[A];var P=k[E],U=I[E];if(P===R||U===R){var q=P===R?z[E]:w,L=U===R?B[E]:w,j=N(q,L);b(j,w)?T.splice(A,1):(O.push(j),A++)}}}return C[x]=T.length,S};return u}var i=r(42);t.name="algorithm05",t.factory=n},function(e,t){"use strict";function r(e,t,r,n){var i=n("multiplyScalar",{"number, number":function(e,t){return e*t},"Complex, Complex":function(e,t){return e.mul(t)},"BigNumber, BigNumber":function(e,t){return e.times(t)},"Fraction, Fraction":function(e,t){return e.mul(t)},"number | Fraction | BigNumber | Complex, Unit":function(e,t){var r=t.clone();return r.value=null===r.value?r._normalize(e):i(r.value,e),r},"Unit, number | Fraction | BigNumber | Complex":function(e,t){var r=e.clone();return r.value=null===r.value?r._normalize(t):i(r.value,t),r},"Unit, Unit":function(e,t){return e.multiply(t)}});return i}t.factory=r},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(80)),o=i("divide",{"number, number":function(e,t){return e/t},"Complex, Complex":function(e,t){return e.div(t)},"BigNumber, BigNumber":function(e,t){return e.div(t)},"Fraction, Fraction":function(e,t){return e.div(t)},"Unit, number | Fraction | BigNumber":function(e,t){var r=e.clone();return r.value=o(null===r.value?r._normalize(1):r.value,t),r},"number | Fraction | BigNumber, Unit":function(e,t){var r=t.pow(-1);return r.value=a(null===r.value?r._normalize(1):r.value,e),r},"Unit, Unit":function(e,t){return e.divide(t)}});return o}t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(r,n){if(t.predictable&&!i(n)&&0>r)try{var a=m(n),o=d(a);if((n===o||Math.abs((n-o)/n)<1e-14)&&a.d%2===1)return(a.n%2===0?1:-1)*Math.pow(-r,n)}catch(s){}return i(n)||r>=0||t.predictable?Math.pow(r,n):new e.Complex(r,0).pow(n,0)}function u(e,t){if(!i(t)||0>t)throw new TypeError("For A^b, b must be a positive integer (value is "+t+")");var r=a(e);if(2!=r.length)throw new Error("For A^b, A must be 2 dimensional (A has "+r.length+" dimensions)");if(r[0]!=r[1])throw new Error("For A^b, A must be square (size is "+r[0]+"x"+r[1]+")");for(var n=l(r[0]).valueOf(),o=e;t>=1;)1==(1&t)&&(n=p(o,n)),t>>=1,o=p(o,o);return n}function c(e,t){return h(u(e.valueOf(),t))}var f=r(32),l=n(r(83)),p=n(r(84)),h=n(r(52)),m=n(r(36)),d=n(r(70)),g=o("pow",{"number, number":s,"Complex, Complex":function(e,t){return e.pow(t)},"BigNumber, BigNumber":function(r,n){return n.isInteger()||r>=0||t.predictable?r.pow(n):new e.Complex(r.toNumber(),0).pow(n.toNumber(),0)},"Fraction, Fraction":function(e,r){if(1!==r.d){if(t.predictable)throw new Error("Function pow does not support non-integer exponents for fractions.");return s(e.valueOf(),r.valueOf())}return e.pow(r)},"Array, number":u,"Array, BigNumber":function(e,t){return u(e,t.toNumber())},"Matrix, number":c,"Matrix, BigNumber":function(e,t){return c(e,t.toNumber())},"Unit, number":function(e,t){return e.pow(t)}});return g.toTex={2:"\\left(${args[0]}\\right)"+f.operators.pow+"{${args[1]}}"},g}var i=r(6).isInteger,a=r(40).size;t.name="pow",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(e,t){switch(e.length){case 0:return t?c(t):[];case 1:return u(e[0],e[0],t);case 2:return u(e[0],e[1],t);default:throw new Error("Vector containing two values expected")}}function u(t,r,n){var o=t&&t.isBigNumber===!0?e.BigNumber:r&&r.isBigNumber===!0?e.BigNumber:null;if(t&&t.isBigNumber===!0&&(t=t.toNumber()),r&&r.isBigNumber===!0&&(r=r.toNumber()),!a(t)||1>t)throw new Error("Parameters in function eye must be positive integers");if(!a(r)||1>r)throw new Error("Parameters in function eye must be positive integers");var s=o?new e.BigNumber(1):1,u=o?new o(0):0,c=[t,r];if(n){var f=e.Matrix.storage(n);return f.diagonal(c,s,0,u)}for(var l=i.resize([],c,u),p=r>t?t:r,h=0;p>h;h++)l[h][h]=s;return l}var c=n(r(52)),f=o("eye",{"":function(){return"Matrix"===t.matrix?c([]):[]},string:function(e){return c(e)},"number | BigNumber":function(e){return u(e,e,"Matrix"===t.matrix?"default":void 0)},"number | BigNumber, string":function(e,t){return u(e,e,t)},"number | BigNumber, number | BigNumber":function(e,r){return u(e,r,"Matrix"===t.matrix?"default":void 0)},"number | BigNumber, number | BigNumber, string":function(e,t,r){return u(e,t,r)},Array:function(e){return s(e)},"Array, string":function(e,t){return s(e,t)},Matrix:function(e){return s(e.valueOf(),e.storage())},"Matrix, string":function(e,t){return s(e.valueOf(),t)}});return f.toTex=void 0,f}var i=r(40),a=r(6).isInteger;t.name="eye",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=r(32),u=n(r(52)),c=n(r(53)),f=n(r(80)),l=n(r(48)),p=n(r(85)),h=n(r(58)),m=e.DenseMatrix,d=e.SparseMatrix,g=o("multiply",i({"Array, Array":function(e,t){v(a.size(e),a.size(t));var r=g(u(e),u(t));return r&&r.isMatrix===!0?r.valueOf():r},"Matrix, Matrix":function(e,t){var r=e.size(),n=t.size();return v(r,n),1===r.length?1===n.length?y(e,t,r[0]):x(e,t):1===n.length?w(e,t):N(e,t)},"Matrix, Array":function(e,t){return g(e,u(t))},"Array, Matrix":function(e,t){return g(u(e,t.storage()),t)},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=p(e,t,f,!1);break;case"dense":r=h(e,t,f,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=p(t,e,f,!0);break;case"dense":r=h(t,e,f,!0)}return r},"Array, any":function(e,t){return h(u(e),t,f,!1).valueOf()},"any, Array":function(e,t){return h(u(t),e,f,!0).valueOf()}},f.signatures)),v=function(e,t){switch(e.length){case 1:switch(t.length){case 1:if(e[0]!==t[0])throw new RangeError("Dimension mismatch in multiplication. Vectors must have the same length");break;case 2:if(e[0]!==t[0])throw new RangeError("Dimension mismatch in multiplication. Vector length ("+e[0]+") must match Matrix rows ("+t[0]+")");break;default:throw new Error("Can only multiply a 1 or 2 dimensional matrix (Matrix B has "+t.length+" dimensions)")}break;case 2:switch(t.length){case 1:if(e[1]!==t[0])throw new RangeError("Dimension mismatch in multiplication. Matrix columns ("+e[1]+") must match Vector length ("+t[0]+")");break;case 2:if(e[1]!==t[0])throw new RangeError("Dimension mismatch in multiplication. Matrix A columns ("+e[1]+") must match Matrix B rows ("+t[0]+")");break;default:throw new Error("Can only multiply a 1 or 2 dimensional matrix (Matrix B has "+t.length+" dimensions)")}break;default:throw new Error("Can only multiply a 1 or 2 dimensional matrix (Matrix A has "+e.length+" dimensions)")}},y=function(e,t,r){if(0===r)throw new Error("Cannot multiply two empty vectors");var n,i=e._data,a=e._datatype,s=t._data,u=t._datatype,l=c,p=f;
a&&u&&a===u&&"string"==typeof a&&(n=a,l=o.find(c,[n,n]),p=o.find(f,[n,n]));for(var h=p(i[0],s[0]),m=1;r>m;m++)h=l(h,p(i[m],s[m]));return h},x=function(e,t){switch(t.storage()){case"dense":return b(e,t)}throw new Error("Not implemented")},b=function(e,t){var r,n=e._data,i=e._size,a=e._datatype,s=t._data,u=t._size,l=t._datatype,p=i[0],h=u[1],d=c,g=f;a&&l&&a===l&&"string"==typeof a&&(r=a,d=o.find(c,[r,r]),g=o.find(f,[r,r]));for(var v=[],y=0;h>y;y++){for(var x=g(n[0],s[0][y]),b=1;p>b;b++)x=d(x,g(n[b],s[b][y]));v[y]=x}return new m({data:v,size:[h],datatype:r})},w=function(e,t){switch(e.storage()){case"dense":return E(e,t);case"sparse":return _(e,t)}},N=function(e,t){switch(e.storage()){case"dense":switch(t.storage()){case"dense":return M(e,t);case"sparse":return A(e,t)}break;case"sparse":switch(t.storage()){case"dense":return O(e,t);case"sparse":return T(e,t)}}},E=function(e,t){var r,n=e._data,i=e._size,a=e._datatype,s=t._data,u=t._datatype,l=i[0],p=i[1],h=c,d=f;a&&u&&a===u&&"string"==typeof a&&(r=a,h=o.find(c,[r,r]),d=o.find(f,[r,r]));for(var g=[],v=0;l>v;v++){for(var y=n[v],x=d(y[0],s[0]),b=1;p>b;b++)x=h(x,d(y[b],s[b]));g[v]=x}return new m({data:g,size:[l],datatype:r})},M=function(e,t){var r,n=e._data,i=e._size,a=e._datatype,s=t._data,u=t._size,l=t._datatype,p=i[0],h=i[1],d=u[1],g=c,v=f;a&&l&&a===l&&"string"==typeof a&&(r=a,g=o.find(c,[r,r]),v=o.find(f,[r,r]));for(var y=[],x=0;p>x;x++){var b=n[x];y[x]=[];for(var w=0;d>w;w++){for(var N=v(b[0],s[0][w]),E=1;h>E;E++)N=g(N,v(b[E],s[E][w]));y[x][w]=N}}return new m({data:y,size:[p,d],datatype:r})},A=function(e,t){var r=e._data,n=e._size,i=e._datatype,a=t._values,s=t._index,u=t._ptr,p=t._size,h=t._datatype;if(!a)throw new Error("Cannot multiply Dense Matrix times Pattern only Matrix");var m,g=n[0],v=p[1],y=c,x=f,b=l,w=0;i&&h&&i===h&&"string"==typeof i&&(m=i,y=o.find(c,[m,m]),x=o.find(f,[m,m]),b=o.find(l,[m,m]),w=o.convert(0,m));for(var N=[],E=[],M=[],A=new d({values:N,index:E,ptr:M,size:[g,v],datatype:m}),_=0;v>_;_++){M[_]=E.length;var O=u[_],T=u[_+1];if(T>O)for(var C=0,S=0;g>S;S++){for(var z,B=S+1,k=O;T>k;k++){var I=s[k];C!==B?(z=x(r[S][I],a[k]),C=B):z=y(z,x(r[S][I],a[k]))}C!==B||b(z,w)||(E.push(S),N.push(z))}}return M[v]=E.length,A},_=function(e,t){var r=e._values,n=e._index,i=e._ptr,a=e._datatype;if(!r)throw new Error("Cannot multiply Pattern only Matrix times Dense Matrix");var s,u=t._data,p=t._datatype,h=e._size[0],m=t._size[0],g=[],v=[],y=[],x=c,b=f,w=l,N=0;a&&p&&a===p&&"string"==typeof a&&(s=a,x=o.find(c,[s,s]),b=o.find(f,[s,s]),w=o.find(l,[s,s]),N=o.convert(0,s));var E=[],M=[];y[0]=0;for(var A=0;m>A;A++){var _=u[A];if(!w(_,N))for(var O=i[A],T=i[A+1],C=O;T>C;C++){var S=n[C];M[S]?E[S]=x(E[S],b(_,r[C])):(M[S]=!0,v.push(S),E[S]=b(_,r[C]))}}for(var z=v.length,B=0;z>B;B++){var k=v[B];g[B]=E[k]}return y[1]=v.length,new d({values:g,index:v,ptr:y,size:[h,1],datatype:s})},O=function(e,t){var r=e._values,n=e._index,i=e._ptr,a=e._datatype;if(!r)throw new Error("Cannot multiply Pattern only Matrix times Dense Matrix");var s,u=t._data,p=t._datatype,h=e._size[0],m=t._size[0],g=t._size[1],v=c,y=f,x=l,b=0;a&&p&&a===p&&"string"==typeof a&&(s=a,v=o.find(c,[s,s]),y=o.find(f,[s,s]),x=o.find(l,[s,s]),b=o.convert(0,s));for(var w=[],N=[],E=[],M=new d({values:w,index:N,ptr:E,size:[h,g],datatype:s}),A=[],_=[],O=0;g>O;O++){E[O]=N.length;for(var T=O+1,C=0;m>C;C++){var S=u[C][O];if(!x(S,b))for(var z=i[C],B=i[C+1],k=z;B>k;k++){var I=n[k];_[I]!==T?(_[I]=T,N.push(I),A[I]=y(S,r[k])):A[I]=v(A[I],y(S,r[k]))}}for(var R=E[O],P=N.length,U=R;P>U;U++){var q=N[U];w[U]=A[q]}}return E[g]=N.length,M},T=function(e,t){var r,n=e._values,i=e._index,a=e._ptr,s=e._datatype,u=t._values,l=t._index,p=t._ptr,h=t._datatype,m=e._size[0],g=t._size[1],v=n&&u,y=c,x=f;s&&h&&s===h&&"string"==typeof s&&(r=s,y=o.find(c,[r,r]),x=o.find(f,[r,r]));for(var b,w,N,E,M,A,_,O,T=v?[]:void 0,C=[],S=[],z=new d({values:T,index:C,ptr:S,size:[m,g],datatype:r}),B=v?[]:void 0,k=[],I=0;g>I;I++){S[I]=C.length;var R=I+1;for(M=p[I],A=p[I+1],E=M;A>E;E++)if(O=l[E],v)for(w=a[O],N=a[O+1],b=w;N>b;b++)_=i[b],k[_]!==R?(k[_]=R,C.push(_),B[_]=x(u[E],n[b])):B[_]=y(B[_],x(u[E],n[b]));else for(w=a[O],N=a[O+1],b=w;N>b;b++)_=i[b],k[_]!==R&&(k[_]=R,C.push(_));if(v)for(var P=S[I],U=C.length,q=P;U>q;q++){var L=C[q];T[q]=B[L]}}return S[g]=C.length,z};return g.toTex={2:"\\left(${args[0]}"+s.operators.multiply+"${args[1]}\\right)"},g}var i=r(3).extend,a=r(40);t.name="multiply",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(48)),o=e.SparseMatrix,s=function(e,t,r,n){var s=e._values,u=e._index,c=e._ptr,f=e._size,l=e._datatype;if(!s)throw new Error("Cannot perform operation on Pattern Sparse Matrix and Scalar value");var p,h=f[0],m=f[1],d=a,g=0,v=r;"string"==typeof l&&(p=l,d=i.find(a,[p,p]),g=i.convert(0,p),t=i.convert(t,p),v=i.find(r,[p,p]));for(var y=[],x=[],b=[],w=new o({values:y,index:x,ptr:b,size:[h,m],datatype:p}),N=0;m>N;N++){b[N]=x.length;for(var E=c[N],M=c[N+1],A=E;M>A;A++){var _=u[A],O=n?v(t,s[A]):v(s[A],t);d(O,g)||(x.push(_),y.push(O))}}return b[m]=x.length,w};return s}t.name="algorithm11",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("abs",{number:Math.abs,Complex:function(e){return e.abs()},BigNumber:function(e){return e.abs()},Fraction:function(e){return e.abs()},"Array | Matrix":function(e){return i(e,a,!0)},Unit:function(e){return e.abs()}});return a.toTex={1:"\\left|${args[0]}\\right|"},a}var i=r(19);t.name="abs",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(52)),o=n(r(48)),s=n(r(61)),u=n(r(62)),c=n(r(63)),f=n(r(57)),l=n(r(58)),p=r(32),h=i("equal",{"any, any":function(e,t){return null===e?null===t:null===t?null===e:void 0===e?void 0===t:void 0===t?void 0===e:o(e,t)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=u(e,t,o);break;default:r=s(t,e,o,!0)}break;default:switch(t.storage()){case"sparse":r=s(e,t,o,!1);break;default:r=f(e,t,o)}}return r},"Array, Array":function(e,t){return h(a(e),a(t)).valueOf()},"Array, Matrix":function(e,t){return h(a(e),t)},"Matrix, Array":function(e,t){return h(e,a(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=c(e,t,o,!1);break;default:r=l(e,t,o,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=c(t,e,o,!0);break;default:r=l(t,e,o,!0)}return r},"Array, any":function(e,t){return l(a(e),t,o,!1).valueOf()},"any, Array":function(e,t){return l(a(t),e,o,!0).valueOf()}});return h.toTex={2:"\\left(${args[0]}"+p.operators.equal+"${args[1]}\\right)"},h}t.name="equal",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("isNumeric",{"number | BigNumber | Fraction | boolean":function(){return!0},"Complex | Unit | string":function(){return!1},"Array | Matrix":function(e){return i(e,a)}});return a}var i=r(19);r(6);t.name="isNumeric",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("format",{any:i.format,"any, Object | function | number":i.format});return a.toTex=void 0,a}var i=r(23);t.name="format",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("_typeof",{any:function(e){var t=i.type(e);if("Object"===t){if(e.isBigNumber===!0)return"BigNumber";if(e.isComplex===!0)return"Complex";if(e.isFraction===!0)return"Fraction";if(e.isMatrix===!0)return"Matrix";if(e.isUnit===!0)return"Unit";if(e.isIndex===!0)return"Index";if(e.isRange===!0)return"Range";if(e.isChain===!0)return"Chain";if(e.isHelp===!0)return"Help"}return t}});return a.toTex=void 0,a}var i=r(41);t.name="typeof",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("unit",{Unit:function(e){return e.clone()},string:function(t){return e.Unit.isValuelessUnit(t)?new e.Unit(null,t):e.Unit.parse(t)},"number | BigNumber | Fraction | Complex, string":function(t,r){return new e.Unit(t,r)},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\left(${args[0]}\\right)",2:"\\left(\\left(${args[0]}\\right)${args[1]}\\right)"},a}var i=r(19);t.name="unit",t.factory=n},function(e,t,r){function n(e,t,r,n,a){function o(t){var r=e.Unit.parse(t);return r.fixPrefix=!0,r}i(a,"speedOfLight",function(){return o("299792458 m s^-1")}),i(a,"gravitationConstant",function(){return o("6.6738480e-11 m^3 kg^-1 s^-2")}),i(a,"planckConstant",function(){return o("6.626069311e-34 J s")}),i(a,"reducedPlanckConstant",function(){return o("1.05457172647e-34 J s")}),i(a,"magneticConstant",function(){return o("1.2566370614e-6 N A^-2")}),i(a,"electricConstant",function(){return o("8.854187817e-12 F m^-1")}),i(a,"vacuumImpedance",function(){return o("376.730313461 ohm")}),i(a,"coulomb",function(){return o("8.9875517873681764e9 N m^2 C^-2")}),i(a,"elementaryCharge",function(){return o("1.60217656535e-19 C")}),i(a,"bohrMagneton",function(){return o("9.2740096820e-24 J T^-1")}),i(a,"conductanceQuantum",function(){return o("7.748091734625e-5 S")}),i(a,"inverseConductanceQuantum",function(){return o("12906.403721742 ohm")}),i(a,"magneticFluxQuantum",function(){return o("2.06783375846e-15 Wb")}),i(a,"nuclearMagneton",function(){return o("5.0507835311e-27 J T^-1")}),i(a,"klitzing",function(){return o("25812.807443484 ohm")}),i(a,"bohrRadius",function(){return o("5.291772109217e-11 m")}),i(a,"classicalElectronRadius",function(){return o("2.817940326727e-15 m")}),i(a,"electronMass",function(){return o("9.1093829140e-31 kg")}),i(a,"fermiCoupling",function(){return o("1.1663645e-5 GeV^-2")}),i(a,"fineStructure",function(){return.007297352569824}),i(a,"hartreeEnergy",function(){return o("4.3597443419e-18 J")}),i(a,"protonMass",function(){return o("1.67262177774e-27 kg")}),i(a,"deuteronMass",function(){return o("3.3435830926e-27 kg")}),i(a,"neutronMass",function(){return o("1.6749271613e-27 kg")}),i(a,"quantumOfCirculation",function(){return o("3.636947552024e-4 m^2 s^-1")}),i(a,"rydberg",function(){return o("10973731.56853955 m^-1")}),i(a,"thomsonCrossSection",function(){return o("6.65245873413e-29 m^2")}),i(a,"weakMixingAngle",function(){return.222321}),i(a,"efimovFactor",function(){return 22.7}),i(a,"atomicMass",function(){return o("1.66053892173e-27 kg")}),i(a,"avogadro",function(){return o("6.0221412927e23 mol^-1")}),i(a,"boltzmann",function(){return o("1.380648813e-23 J K^-1")}),i(a,"faraday",function(){return o("96485.336521 C mol^-1")}),i(a,"firstRadiation",function(){return o("3.7417715317e-16 W m^2")}),i(a,"loschmidt",function(){return o("2.686780524e25 m^-3")}),i(a,"gasConstant",function(){return o("8.314462175 J K^-1 mol^-1")}),i(a,"molarPlanckConstant",function(){return o("3.990312717628e-10 J s mol^-1")}),i(a,"molarVolume",function(){return o("2.241396820e-10 m^3 mol^-1")}),i(a,"sackurTetrode",function(){return-1.164870823}),i(a,"secondRadiation",function(){return o("1.438777013e-2 m K")}),i(a,"stefanBoltzmann",function(){return o("5.67037321e-8 W m^-2 K^-4")}),i(a,"wienDisplacement",function(){return o("2.897772126e-3 m K")}),i(a,"molarMass",function(){return o("1e-3 kg mol^-1")}),i(a,"molarMassC12",function(){return o("1.2e-2 kg mol^-1")}),i(a,"gravity",function(){return o("9.80665 m s^-2")}),i(a,"planckLength",function(){return o("1.61619997e-35 m")}),i(a,"planckMass",function(){return o("2.1765113e-8 kg")}),i(a,"planckTime",function(){return o("5.3910632e-44 s")}),i(a,"planckCharge",function(){return o("1.87554595641e-18 C")}),i(a,"planckTemperature",function(){return o("1.41683385e+32 K")})}var i=r(3).lazy;t.factory=n,t.lazy=!1,t.math=!0},function(e,t,r){"use strict";function n(e,t,o,s,u){u.on("config",function(r,i){r.number!==i.number&&n(e,t,o,s,u)}),u["true"]=!0,u["false"]=!1,u["null"]=null,u.uninitialized=r(40).UNINITIALIZED,"BigNumber"===t.number?(u.Infinity=new e.BigNumber(1/0),u.NaN=new e.BigNumber(NaN),i.lazy(u,"pi",function(){return a.pi(e.BigNumber)}),i.lazy(u,"tau",function(){return a.tau(e.BigNumber)}),i.lazy(u,"e",function(){return a.e(e.BigNumber)}),i.lazy(u,"phi",function(){return a.phi(e.BigNumber)}),i.lazy(u,"E",function(){return u.e}),i.lazy(u,"LN2",function(){return new e.BigNumber(2).ln()}),i.lazy(u,"LN10",function(){return new e.BigNumber(10).ln()}),i.lazy(u,"LOG2E",function(){return new e.BigNumber(1).div(new e.BigNumber(2).ln())}),i.lazy(u,"LOG10E",function(){return new e.BigNumber(1).div(new e.BigNumber(10).ln())}),i.lazy(u,"PI",function(){return u.pi}),i.lazy(u,"SQRT1_2",function(){return new e.BigNumber("0.5").sqrt()}),i.lazy(u,"SQRT2",function(){return new e.BigNumber(2).sqrt()})):(u.Infinity=1/0,u.NaN=NaN,u.pi=Math.PI,u.tau=2*Math.PI,u.e=Math.E,u.phi=1.618033988749895,u.E=u.e,u.LN2=Math.LN2,u.LN10=Math.LN10,u.LOG2E=Math.LOG2E,u.LOG10E=Math.LOG10E,u.PI=u.pi,u.SQRT1_2=Math.SQRT1_2,u.SQRT2=Math.SQRT2),u.i=e.Complex.I,u.version=r(94)}var i=r(3),a=r(76);t.factory=n,t.lazy=!1,t.math=!0},function(e,t){e.exports="3.2.1"},function(e,t,r){e.exports=[r(96),r(268),r(297),r(299),r(325),r(270),r(296)]},function(e,t,r){function n(e,t,n,i){var a={};return a.bignumber=r(97),a["boolean"]=r(98),a.complex=r(99),a.fraction=r(100),a.index=r(101),a.matrix=r(102),a.number=r(103),a.sparse=r(104),a.string=r(105),a.unit=r(106),a.e=r(107),a.E=r(107),a["false"]=r(108),a.i=r(109),a.Infinity=r(110),a.LN2=r(111),a.LN10=r(112),a.LOG2E=r(113),a.LOG10E=r(114),a.NaN=r(115),a["null"]=r(116),a.pi=r(117),a.PI=r(117),a.phi=r(118),a.SQRT1_2=r(119),a.SQRT2=r(120),a.tau=r(121),a["true"]=r(122),a.version=r(123),a.speedOfLight={description:"Speed of light in vacuum",examples:["speedOfLight"]},a.gravitationConstant={description:"Newtonian constant of gravitation",examples:["gravitationConstant"]},a.planckConstant={description:"Planck constant",examples:["planckConstant"]},a.reducedPlanckConstant={description:"Reduced Planck constant",examples:["reducedPlanckConstant"]},a.magneticConstant={description:"Magnetic constant (vacuum permeability)",examples:["magneticConstant"]},a.electricConstant={description:"Electric constant (vacuum permeability)",examples:["electricConstant"]},a.vacuumImpedance={description:"Characteristic impedance of vacuum",examples:["vacuumImpedance"]},a.coulomb={description:"Coulomb's constant",examples:["coulomb"]},a.elementaryCharge={description:"Elementary charge",examples:["elementaryCharge"]},a.bohrMagneton={description:"Borh magneton",examples:["bohrMagneton"]},a.conductanceQuantum={description:"Conductance quantum",examples:["conductanceQuantum"]},a.inverseConductanceQuantum={description:"Inverse conductance quantum",examples:["inverseConductanceQuantum"]},a.magneticFluxQuantum={description:"Magnetic flux quantum",examples:["magneticFluxQuantum"]},a.nuclearMagneton={description:"Nuclear magneton",examples:["nuclearMagneton"]},a.klitzing={description:"Von Klitzing constant",examples:["klitzing"]},a.bohrRadius={description:"Borh radius",examples:["bohrRadius"]},a.classicalElectronRadius={description:"Classical electron radius",examples:["classicalElectronRadius"]},a.electronMass={description:"Electron mass",examples:["electronMass"]},a.fermiCoupling={description:"Fermi coupling constant",examples:["fermiCoupling"]},a.fineStructure={description:"Fine-structure constant",examples:["fineStructure"]},a.hartreeEnergy={description:"Hartree energy",examples:["hartreeEnergy"]},a.protonMass={description:"Proton mass",examples:["protonMass"]},a.deuteronMass={description:"Deuteron Mass",examples:["deuteronMass"]},a.neutronMass={description:"Neutron mass",examples:["neutronMass"]},a.quantumOfCirculation={description:"Quantum of circulation",examples:["quantumOfCirculation"]},a.rydberg={description:"Rydberg constant",examples:["rydberg"]},a.thomsonCrossSection={description:"Thomson cross section",examples:["thomsonCrossSection"]},a.weakMixingAngle={description:"Weak mixing angle",examples:["weakMixingAngle"]},a.efimovFactor={description:"Efimov factor",examples:["efimovFactor"]},a.atomicMass={description:"Atomic mass constant",examples:["atomicMass"]},a.avogadro={description:"Avogadro's number",examples:["avogadro"]},a.boltzmann={description:"Boltzmann constant",examples:["boltzmann"]},a.faraday={description:"Faraday constant",examples:["faraday"]},a.firstRadiation={description:"First radiation constant",examples:["firstRadiation"]},a.loschmidt={description:"Loschmidt constant at T=273.15 K and p=101.325 kPa",examples:["loschmidt"]},a.gasConstant={description:"Gas constant",examples:["gasConstant"]},a.molarPlanckConstant={description:"Molar Planck constant",examples:["molarPlanckConstant"]},a.molarVolume={description:"Molar volume of an ideal gas at T=273.15 K and p=101.325 kPa",examples:["molarVolume"]},a.sackurTetrode={description:"Sackur-Tetrode constant at T=1 K and p=101.325 kPa",examples:["sackurTetrode"]},a.secondRadiation={description:"Second radiation constant",examples:["secondRadiation"]},a.stefanBoltzmann={description:"Stefan-Boltzmann constant",examples:["stefanBoltzmann"]},a.wienDisplacement={description:"Wien displacement law constant",examples:["wienDisplacement"]},a.molarMass={description:"Molar mass constant",examples:["molarMass"]},a.molarMassC12={description:"Molar mass constant of carbon-12",examples:["molarMassC12"]},a.gravity={description:"Standard acceleration of gravity (standard acceleration of free-fall on Earth)",examples:["gravity"]},a.planckLength={description:"Planck length",examples:["planckLength"]},a.planckMass={description:"Planck mass",examples:["planckMass"]},a.planckTime={description:"Planck time",examples:["planckTime"]},a.planckCharge={description:"Planck charge",examples:["planckCharge"]},a.planckTemperature={description:"Planck temperature",examples:["planckTemperature"]},a.lsolve=r(124),a.lup=r(125),a.lusolve=r(126),a.slu=r(127),a.usolve=r(128),a.abs=r(129),a.add=r(130),a.cbrt=r(131),a.ceil=r(132),a.cube=r(133),a.divide=r(134),a.dotDivide=r(135),a.dotMultiply=r(136),a.dotPow=r(137),a.exp=r(138),a.fix=r(139),a.floor=r(140),a.gcd=r(141),a.hypot=r(142),a.lcm=r(143),a.log=r(144),a.log10=r(145),a.mod=r(146),a.multiply=r(147),a.norm=r(148),a.nthRoot=r(149),a.pow=r(150),a.round=r(151),a.sign=r(152),a.sqrt=r(153),a.square=r(154),a.subtract=r(155),a.unaryMinus=r(156),a.unaryPlus=r(157),a.xgcd=r(158),a.bitAnd=r(159),a.bitNot=r(160),a.bitOr=r(161),a.bitXor=r(162),a.leftShift=r(163),a.rightArithShift=r(164),a.rightLogShift=r(165),a.bellNumbers=r(166),a.catalan=r(167),a.composition=r(168),a.stirlingS2=r(169),a.config=r(170),a["import"]=r(171),a.typed=r(172),a.arg=r(173),a.conj=r(174),a.re=r(175),a.im=r(176),a.eval=r(177),a.help=r(178),a.distance=r(179),a.intersect=r(180),a.and=r(181),a.not=r(182),a.or=r(183),a.xor=r(184),a.concat=r(185),a.cross=r(186),a.det=r(187),a.diag=r(188),a.dot=r(189),a.eye=r(190),a.filter=r(191),a.flatten=r(192),a.forEach=r(193),a.inv=r(194),a.map=r(195),a.ones=r(196),a.partitionSelect=r(197),a.range=r(198),a.resize=r(199),a.size=r(200),a.sort=r(201),a.squeeze=r(202),a.subset=r(203),a.trace=r(204),a.transpose=r(205),a.zeros=r(206),a.combinations=r(207),a.factorial=r(208),a.gamma=r(209),a.kldivergence=r(210),a.multinomial=r(211),a.permutations=r(212),a.pickRandom=r(213),a.random=r(214),a.randomInt=r(215),a.compare=r(216),a.deepEqual=r(217),a.equal=r(218),a.larger=r(219),a.largerEq=r(220),a.smaller=r(221),a.smallerEq=r(222),a.unequal=r(223),a.max=r(224),a.mean=r(225),a.median=r(226),a.min=r(227),a.mode=r(228),a.prod=r(229),a.quantileSeq=r(230),a.std=r(231),a.sum=r(232),a["var"]=r(233),a.acos=r(234),a.acosh=r(235),a.acot=r(236),a.acoth=r(237),a.acsc=r(238),a.acsch=r(239),a.asec=r(240),a.asech=r(241),a.asin=r(242),a.asinh=r(243),a.atan=r(244),a.atanh=r(245),a.atan2=r(246),a.cos=r(247),a.cosh=r(248),a.cot=r(249),a.coth=r(250),a.csc=r(251),a.csch=r(252),a.sec=r(253),a.sech=r(254),a.sin=r(255),a.sinh=r(256),a.tan=r(257),a.tanh=r(258),a.to=r(259),a.clone=r(260),a.format=r(261),a.isInteger=r(262),a.isNegative=r(263),a.isNumeric=r(264),a.isPositive=r(265),a.isZero=r(266),a["typeof"]=r(267),a}t.name="docs",t.path="expression",t.factory=n},function(e,t){e.exports={name:"bignumber",category:"Construction",syntax:["bignumber(x)"],description:"Create a big number from a number or string.",examples:["0.1 + 0.2","bignumber(0.1) + bignumber(0.2)",'bignumber("7.2")','bignumber("7.2e500")',"bignumber([0.1, 0.2, 0.3])"],seealso:["boolean","complex","fraction","index","matrix","string","unit"]}},function(e,t){e.exports={name:"boolean",category:"Construction",syntax:["x","boolean(x)"],description:"Convert a string or number into a boolean.",examples:["boolean(0)","boolean(1)","boolean(3)",'boolean("true")','boolean("false")',"boolean([1, 0, 1, 1])"],seealso:["bignumber","complex","index","matrix","number","string","unit"]}},function(e,t){e.exports={name:"complex",category:"Construction",syntax:["complex()","complex(re, im)","complex(string)"],description:"Create a complex number.",examples:["complex()","complex(2, 3)",'complex("7 - 2i")'],seealso:["bignumber","boolean","index","matrix","number","string","unit"]}},function(e,t){e.exports={name:"fraction",category:"Construction",syntax:["fraction(num)","fraction(num,den)"],description:"Create a fraction from a number or from a numerator and denominator.",examples:["fraction(0.125)","fraction(1, 3) + fraction(2, 5)"],seealso:["bignumber","boolean","complex","index","matrix","string","unit"]}},function(e,t){e.exports={name:"index",category:"Construction",syntax:["[start]","[start:end]","[start:step:end]","[start1, start 2, ...]","[start1:end1, start2:end2, ...]","[start1:step1:end1, start2:step2:end2, ...]"],description:"Create an index to get or replace a subset of a matrix",examples:["[]","[1, 2, 3]","A = [1, 2, 3; 4, 5, 6]","A[1, :]","A[1, 2] = 50","A[0:2, 0:2] = ones(2, 2)"],seealso:["bignumber","boolean","complex","matrix,","number","range","string","unit"]}},function(e,t){e.exports={name:"matrix",category:"Construction",syntax:["[]","[a1, b1, ...; a2, b2, ...]","matrix()",'matrix("dense")',"matrix([...])"],description:"Create a matrix.",examples:["[]","[1, 2, 3]","[1, 2, 3; 4, 5, 6]","matrix()","matrix([3, 4])",'matrix([3, 4; 5, 6], "sparse")','matrix([3, 4; 5, 6], "sparse", "number")'],seealso:["bignumber","boolean","complex","index","number","string","unit","sparse"]}},function(e,t){e.exports={name:"number",category:"Construction",syntax:["x","number(x)"],description:"Create a number or convert a string or boolean into a number.",examples:["2","2e3","4.05","number(2)",'number("7.2")',"number(true)","number([true, false, true, true])",'number("52cm", "m")'],seealso:["bignumber","boolean","complex","fraction","index","matrix","string","unit"]}},function(e,t){e.exports={name:"sparse",category:"Construction",syntax:["sparse()","sparse([a1, b1, ...; a1, b2, ...])",'sparse([a1, b1, ...; a1, b2, ...], "number")'],description:"Create a sparse matrix.",examples:["sparse()","sparse([3, 4; 5, 6])",'sparse([3, 0; 5, 0], "number")'],seealso:["bignumber","boolean","complex","index","number","string","unit","matrix"]}},function(e,t){e.exports={name:"string",category:"Construction",syntax:['"text"',"string(x)"],description:"Create a string or convert a value to a string",examples:['"Hello World!"',"string(4.2)","string(3 + 2i)"],seealso:["bignumber","boolean","complex","index","matrix","number","unit"]}},function(e,t){e.exports={name:"unit",category:"Construction",syntax:["value unit","unit(value, unit)","unit(string)"],description:"Create a unit.",examples:["5.5 mm","3 inch",'unit(7.1, "kilogram")','unit("23 deg")'],seealso:["bignumber","boolean","complex","index","matrix","number","string"]}},function(e,t){e.exports={name:"e",category:"Constants",syntax:["e"],description:"Euler's number, the base of the natural logarithm. Approximately equal to 2.71828",examples:["e","e ^ 2","exp(2)","log(e)"],seealso:["exp"]}},function(e,t){e.exports={name:"false",category:"Constants",syntax:["false"],description:"Boolean value false",examples:["false"],seealso:["true"]}},function(e,t){e.exports={name:"i",category:"Constants",syntax:["i"],description:"Imaginary unit, defined as i*i=-1. A complex number is described as a + b*i, where a is the real part, and b is the imaginary part.",examples:["i","i * i","sqrt(-1)"],seealso:[]}},function(e,t){e.exports={name:"Infinity",category:"Constants",syntax:["Infinity"],description:"Infinity, a number which is larger than the maximum number that can be handled by a floating point number.",examples:["Infinity","1 / 0"],seealso:[]}},function(e,t){e.exports={name:"LN2",category:"Constants",syntax:["LN2"],description:"Returns the natural logarithm of 2, approximately equal to 0.693",examples:["LN2","log(2)"],seealso:[]}},function(e,t){e.exports={name:"LN10",category:"Constants",syntax:["LN10"],description:"Returns the natural logarithm of 10, approximately equal to 2.302",examples:["LN10","log(10)"],seealso:[]}},function(e,t){e.exports={name:"LOG2E",category:"Constants",syntax:["LOG2E"],description:"Returns the base-2 logarithm of E, approximately equal to 1.442",examples:["LOG2E","log(e, 2)"],seealso:[]}},function(e,t){e.exports={name:"LOG10E",category:"Constants",syntax:["LOG10E"],description:"Returns the base-10 logarithm of E, approximately equal to 0.434",examples:["LOG10E","log(e, 10)"],seealso:[]}},function(e,t){e.exports={name:"NaN",category:"Constants",syntax:["NaN"],description:"Not a number",examples:["NaN","0 / 0"],seealso:[]}},function(e,t){e.exports={name:"null",category:"Constants",syntax:["null"],description:"Value null",examples:["null"],seealso:["true","false"]}},function(e,t){e.exports={name:"pi",category:"Constants",syntax:["pi"],description:"The number pi is a mathematical constant that is the ratio of a circle's circumference to its diameter, and is approximately equal to 3.14159",examples:["pi","sin(pi/2)"],seealso:["tau"]}},function(e,t){e.exports={name:"phi",category:"Constants",syntax:["phi"],description:"Phi is the golden ratio. Two quantities are in the golden ratio if their ratio is the same as the ratio of their sum to the larger of the two quantities. Phi is defined as `(1 + sqrt(5)) / 2` and is approximately 1.618034...",examples:["tau"],seealso:[]}},function(e,t){e.exports={name:"SQRT1_2",category:"Constants",syntax:["SQRT1_2"],description:"Returns the square root of 1/2, approximately equal to 0.707",examples:["SQRT1_2","sqrt(1/2)"],seealso:[]}},function(e,t){e.exports={name:"SQRT2",category:"Constants",syntax:["SQRT2"],description:"Returns the square root of 2, approximately equal to 1.414",examples:["SQRT2","sqrt(2)"],seealso:[]}},function(e,t){e.exports={name:"tau",category:"Constants",syntax:["tau"],description:"Tau is the ratio constant of a circle's circumference to radius, equal to 2 * pi, approximately 6.2832.",examples:["tau","2 * pi"],seealso:["pi"]}},function(e,t){e.exports={name:"true",category:"Constants",syntax:["true"],description:"Boolean value true",examples:["true"],seealso:["false"]}},function(e,t){e.exports={name:"version",category:"Constants",syntax:["version"],description:"A string with the version number of math.js",examples:["version"],seealso:[]}},function(e,t){e.exports={name:"lsolve",category:"Algebra",syntax:["x=lsolve(L, b)"],description:"Solves the linear system L * x = b where L is an [n x n] lower triangular matrix and b is a [n] column vector.",examples:["a = [-2, 3; 2, 1]","b = [11, 9]","x = lsolve(a, b)"],seealso:["lup","lusolve","usolve","matrix","sparse"]}},function(e,t){e.exports={name:"lup",category:"Algebra",syntax:["lup(m)"],description:"Calculate the Matrix LU decomposition with partial pivoting. Matrix A is decomposed in three matrices (L, U, P) where P * A = L * U",examples:["lup([[2, 1], [1, 4]])","lup(matrix([[2, 1], [1, 4]]))","lup(sparse([[2, 1], [1, 4]]))"],seealso:["lusolve","lsolve","usolve","matrix","sparse","slu"]}},function(e,t){e.exports={name:"lusolve",category:"Algebra",syntax:["x=lusolve(A, b)","x=lusolve(lu, b)"],description:"Solves the linear system A * x = b where A is an [n x n] matrix and b is a [n] column vector.",examples:["a = [-2, 3; 2, 1]","b = [11, 9]","x = lusolve(a, b)"],seealso:["lup","slu","lsolve","usolve","matrix","sparse"]}},function(e,t){e.exports={name:"slu",category:"Algebra",syntax:["slu(A, order, threshold)"],description:"Calculate the Matrix LU decomposition with full pivoting. Matrix A is decomposed in two matrices (L, U) and two permutation vectors (pinv, q) where P * A * Q = L * U",examples:["slu(sparse([4.5, 0, 3.2, 0; 3.1, 2.9, 0, 0.9; 0, 1.7, 3, 0; 3.5, 0.4, 0, 1]), 1, 0.001)"],seealso:["lusolve","lsolve","usolve","matrix","sparse","lup"]}},function(e,t){e.exports={name:"usolve",category:"Algebra",syntax:["x=usolve(U, b)"],description:"Solves the linear system U * x = b where U is an [n x n] upper triangular matrix and b is a [n] column vector.",examples:["x=usolve(sparse([1, 1, 1, 1; 0, 1, 1, 1; 0, 0, 1, 1; 0, 0, 0, 1]), [1; 2; 3; 4])"],seealso:["lup","lusolve","lsolve","matrix","sparse"]}},function(e,t){e.exports={name:"abs",category:"Arithmetic",syntax:["abs(x)"],description:"Compute the absolute value.",examples:["abs(3.5)","abs(-4.2)"],seealso:["sign"]}},function(e,t){e.exports={name:"add",category:"Operators",syntax:["x + y","add(x, y)"],description:"Add two values.",examples:["a = 2.1 + 3.6","a - 3.6","3 + 2i","3 cm + 2 inch",'"2.3" + "4"'],seealso:["subtract"]}},function(e,t){e.exports={name:"cbrt",category:"Arithmetic",syntax:["cbrt(x)","cbrt(x, allRoots)"],description:"Compute the cubic root value. If x = y * y * y, then y is the cubic root of x. When `x` is a number or complex number, an optional second argument `allRoots` can be provided to return all three cubic roots. If not provided, the principal root is returned",examples:["cbrt(64)","cube(4)","cbrt(-8)","cbrt(2 + 3i)","cbrt(8i)","cbrt(8i, true)","cbrt(27 m^3)"],seealso:["square","sqrt","cube","multiply"]}},function(e,t){e.exports={name:"ceil",category:"Arithmetic",syntax:["ceil(x)"],description:"Round a value towards plus infinity. If x is complex, both real and imaginary part are rounded towards plus infinity.",examples:["ceil(3.2)","ceil(3.8)","ceil(-4.2)"],seealso:["floor","fix","round"]}},function(e,t){e.exports={name:"cube",category:"Arithmetic",syntax:["cube(x)"],description:"Compute the cube of a value. The cube of x is x * x * x.",examples:["cube(2)","2^3","2 * 2 * 2"],seealso:["multiply","square","pow"]}},function(e,t){e.exports={name:"divide",category:"Operators",syntax:["x / y","divide(x, y)"],description:"Divide two values.",examples:["a = 2 / 3","a * 3","4.5 / 2","3 + 4 / 2","(3 + 4) / 2","18 km / 4.5"],seealso:["multiply"]}},function(e,t){e.exports={name:"dotDivide",category:"Operators",syntax:["x ./ y","dotDivide(x, y)"],description:"Divide two values element wise.",examples:["a = [1, 2, 3; 4, 5, 6]","b = [2, 1, 1; 3, 2, 5]","a ./ b"],seealso:["multiply","dotMultiply","divide"]}},function(e,t){e.exports={name:"dotMultiply",category:"Operators",syntax:["x .* y","dotMultiply(x, y)"],description:"Multiply two values element wise.",examples:["a = [1, 2, 3; 4, 5, 6]","b = [2, 1, 1; 3, 2, 5]","a .* b"],seealso:["multiply","divide","dotDivide"]}},function(e,t){e.exports={name:"dotpow",category:"Operators",syntax:["x .^ y","dotpow(x, y)"],description:"Calculates the power of x to y element wise.",examples:["a = [1, 2, 3; 4, 5, 6]","a .^ 2"],seealso:["pow"]}},function(e,t){e.exports={name:"exp",category:"Arithmetic",syntax:["exp(x)"],description:"Calculate the exponent of a value.",examples:["exp(1.3)","e ^ 1.3","log(exp(1.3))","x = 2.4","(exp(i*x) == cos(x) + i*sin(x))   # Euler's formula"],seealso:["pow","log"]}},function(e,t){e.exports={name:"fix",category:"Arithmetic",syntax:["fix(x)"],description:"Round a value towards zero. If x is complex, both real and imaginary part are rounded towards zero.",examples:["fix(3.2)","fix(3.8)","fix(-4.2)","fix(-4.8)"],seealso:["ceil","floor","round"]}},function(e,t){e.exports={name:"floor",category:"Arithmetic",syntax:["floor(x)"],description:"Round a value towards minus infinity.If x is complex, both real and imaginary part are rounded towards minus infinity.",examples:["floor(3.2)","floor(3.8)","floor(-4.2)"],seealso:["ceil","fix","round"]}},function(e,t){e.exports={name:"gcd",category:"Arithmetic",
syntax:["gcd(a, b)","gcd(a, b, c, ...)"],description:"Compute the greatest common divisor.",examples:["gcd(8, 12)","gcd(-4, 6)","gcd(25, 15, -10)"],seealso:["lcm","xgcd"]}},function(e,t){e.exports={name:"hypot",category:"Arithmetic",syntax:["hypot(a, b, c, ...)","hypot([a, b, c, ...])"],description:"Calculate the hypotenusa of a list with values. ",examples:["hypot(3, 4)","sqrt(3^2 + 4^2)","hypot(-2)","hypot([3, 4, 5])"],seealso:["abs","norm"]}},function(e,t){e.exports={name:"lcm",category:"Arithmetic",syntax:["lcm(x, y)"],description:"Compute the least common multiple.",examples:["lcm(4, 6)","lcm(6, 21)","lcm(6, 21, 5)"],seealso:["gcd"]}},function(e,t){e.exports={name:"log",category:"Arithmetic",syntax:["log(x)","log(x, base)"],description:"Compute the logarithm of a value. If no base is provided, the natural logarithm of x is calculated. If base if provided, the logarithm is calculated for the specified base. log(x, base) is defined as log(x) / log(base).",examples:["log(3.5)","a = log(2.4)","exp(a)","10 ^ 4","log(10000, 10)","log(10000) / log(10)","b = log(1024, 2)","2 ^ b"],seealso:["exp","log10"]}},function(e,t){e.exports={name:"log10",category:"Arithmetic",syntax:["log10(x)"],description:"Compute the 10-base logarithm of a value.",examples:["log10(0.00001)","log10(10000)","10 ^ 4","log(10000) / log(10)","log(10000, 10)"],seealso:["exp","log"]}},function(e,t){e.exports={name:"mod",category:"Operators",syntax:["x % y","x mod y","mod(x, y)"],description:"Calculates the modulus, the remainder of an integer division.",examples:["7 % 3","11 % 2","10 mod 4","function isOdd(x) = x % 2","isOdd(2)","isOdd(3)"],seealso:["divide"]}},function(e,t){e.exports={name:"multiply",category:"Operators",syntax:["x * y","multiply(x, y)"],description:"multiply two values.",examples:["a = 2.1 * 3.4","a / 3.4","2 * 3 + 4","2 * (3 + 4)","3 * 2.1 km"],seealso:["divide"]}},function(e,t){e.exports={name:"norm",category:"Arithmetic",syntax:["norm(x)","norm(x, p)"],description:"Calculate the norm of a number, vector or matrix.",examples:["abs(-3.5)","norm(-3.5)","norm(3 - 4i))","norm([1, 2, -3], Infinity)","norm([1, 2, -3], -Infinity)","norm([3, 4], 2)","norm([[1, 2], [3, 4]], 1)","norm([[1, 2], [3, 4]], 'inf')","norm([[1, 2], [3, 4]], 'fro')"]}},function(e,t){e.exports={name:"nthRoot",category:"Arithmetic",syntax:["nthRoot(a)","nthRoot(a, root)"],description:'Calculate the nth root of a value. The principal nth root of a positive real number A, is the positive real solution of the equation "x^root = A".',examples:["4 ^ 3","nthRoot(64, 3)","nthRoot(9, 2)","sqrt(9)"],seealso:["sqrt","pow"]}},function(e,t){e.exports={name:"pow",category:"Operators",syntax:["x ^ y","pow(x, y)"],description:"Calculates the power of x to y, x^y.",examples:["2^3 = 8","2*2*2","1 + e ^ (pi * i)"],seealso:["multiply"]}},function(e,t){e.exports={name:"round",category:"Arithmetic",syntax:["round(x)","round(x, n)"],description:"round a value towards the nearest integer.If x is complex, both real and imaginary part are rounded towards the nearest integer. When n is specified, the value is rounded to n decimals.",examples:["round(3.2)","round(3.8)","round(-4.2)","round(-4.8)","round(pi, 3)","round(123.45678, 2)"],seealso:["ceil","floor","fix"]}},function(e,t){e.exports={name:"sign",category:"Arithmetic",syntax:["sign(x)"],description:"Compute the sign of a value. The sign of a value x is 1 when x>1, -1 when x<0, and 0 when x=0.",examples:["sign(3.5)","sign(-4.2)","sign(0)"],seealso:["abs"]}},function(e,t){e.exports={name:"sqrt",category:"Arithmetic",syntax:["sqrt(x)"],description:"Compute the square root value. If x = y * y, then y is the square root of x.",examples:["sqrt(25)","5 * 5","sqrt(-1)"],seealso:["square","multiply"]}},function(e,t){e.exports={name:"square",category:"Arithmetic",syntax:["square(x)"],description:"Compute the square of a value. The square of x is x * x.",examples:["square(3)","sqrt(9)","3^2","3 * 3"],seealso:["multiply","pow","sqrt","cube"]}},function(e,t){e.exports={name:"subtract",category:"Operators",syntax:["x - y","subtract(x, y)"],description:"subtract two values.",examples:["a = 5.3 - 2","a + 2","2/3 - 1/6","2 * 3 - 3","2.1 km - 500m"],seealso:["add"]}},function(e,t){e.exports={name:"unaryMinus",category:"Operators",syntax:["-x","unaryMinus(x)"],description:"Inverse the sign of a value. Converts booleans and strings to numbers.",examples:["-4.5","-(-5.6)",'-"22"'],seealso:["add","subtract","unaryPlus"]}},function(e,t){e.exports={name:"unaryPlus",category:"Operators",syntax:["+x","unaryPlus(x)"],description:"Converts booleans and strings to numbers.",examples:["+true",'+"2"'],seealso:["add","subtract","unaryMinus"]}},function(e,t){e.exports={name:"xgcd",category:"Arithmetic",syntax:["xgcd(a, b)"],description:"Calculate the extended greatest common divisor for two values",examples:["xgcd(8, 12)","gcd(8, 12)","xgcd(36163, 21199)"],seealso:["gcd","lcm"]}},function(e,t){e.exports={name:"bitAnd",category:"Bitwise",syntax:["x & y","bitAnd(x, y)"],description:"Bitwise AND operation. Performs the logical AND operation on each pair of the corresponding bits of the two given values by multiplying them. If both bits in the compared position are 1, the bit in the resulting binary representation is 1, otherwise, the result is 0",examples:["5 & 3","bitAnd(53, 131)","[1, 12, 31] & 42"],seealso:["bitNot","bitOr","bitXor","leftShift","rightArithShift","rightLogShift"]}},function(e,t){e.exports={name:"bitNot",category:"Bitwise",syntax:["~x","bitNot(x)"],description:"Bitwise NOT operation. Performs a logical negation on each bit of the given value. Bits that are 0 become 1, and those that are 1 become 0.",examples:["~1","~2","bitNot([2, -3, 4])"],seealso:["bitAnd","bitOr","bitXor","leftShift","rightArithShift","rightLogShift"]}},function(e,t){e.exports={name:"bitOr",category:"Bitwise",syntax:["x | y","bitOr(x, y)"],description:"Bitwise OR operation. Performs the logical inclusive OR operation on each pair of corresponding bits of the two given values. The result in each position is 1 if the first bit is 1 or the second bit is 1 or both bits are 1, otherwise, the result is 0.",examples:["5 | 3","bitOr([1, 2, 3], 4)"],seealso:["bitAnd","bitNot","bitXor","leftShift","rightArithShift","rightLogShift"]}},function(e,t){e.exports={name:"bitXor",category:"Bitwise",syntax:["bitXor(x, y)"],description:"Bitwise XOR operation, exclusive OR. Performs the logical exclusive OR operation on each pair of corresponding bits of the two given values. The result in each position is 1 if only the first bit is 1 or only the second bit is 1, but will be 0 if both are 0 or both are 1.",examples:["bitOr(1, 2)","bitXor([2, 3, 4], 4)"],seealso:["bitAnd","bitNot","bitOr","leftShift","rightArithShift","rightLogShift"]}},function(e,t){e.exports={name:"leftShift",category:"Bitwise",syntax:["x << y","leftShift(x, y)"],description:"Bitwise left logical shift of a value x by y number of bits.",examples:["4 << 1","8 >> 1"],seealso:["bitAnd","bitNot","bitOr","bitXor","rightArithShift","rightLogShift"]}},function(e,t){e.exports={name:"rightArithShift",category:"Bitwise",syntax:["x >> y","leftShift(x, y)"],description:"Bitwise right arithmetic shift of a value x by y number of bits.",examples:["8 >> 1","4 << 1","-12 >> 2"],seealso:["bitAnd","bitNot","bitOr","bitXor","leftShift","rightLogShift"]}},function(e,t){e.exports={name:"rightLogShift",category:"Bitwise",syntax:["x >> y","leftShift(x, y)"],description:"Bitwise right logical shift of a value x by y number of bits.",examples:["8 >>> 1","4 << 1","-12 >>> 2"],seealso:["bitAnd","bitNot","bitOr","bitXor","leftShift","rightArithShift"]}},function(e,t){e.exports={name:"bellNumbers",category:"Combinatorics",syntax:["bellNumbers(n)"],description:"The Bell Numbers count the number of partitions of a set. A partition is a pairwise disjoint subset of S whose union is S. `bellNumbers` only takes integer arguments. The following condition must be enforced: n >= 0.",examples:["bellNumbers(3)","bellNumbers(8)"],seealso:["stirlingS2"]}},function(e,t){e.exports={name:"catalan",category:"Combinatorics",syntax:["catalan(n)"],description:"The Catalan Numbers enumerate combinatorial structures of many different types. catalan only takes integer arguments. The following condition must be enforced: n >= 0.",examples:["catalan(3)","catalan(8)"],seealso:["bellNumbers"]}},function(e,t){e.exports={name:"composition",category:"Combinatorics",syntax:["composition(n, k)"],description:"The composition counts of n into k parts. composition only takes integer arguments. The following condition must be enforced: k <= n.",examples:["composition(5, 3)"],seealso:["combinations"]}},function(e,t){e.exports={name:"stirlingS2",category:"Combinatorics",syntax:["stirlingS2(n, k)"],description:"he Stirling numbers of the second kind, counts the number of ways to partition a set of n labelled objects into k nonempty unlabelled subsets. `stirlingS2` only takes integer arguments. The following condition must be enforced: k <= n. If n = k or k = 1, then s(n,k) = 1.",examples:["stirlingS2(5, 3)"],seealso:["bellNumbers"]}},function(e,t){e.exports={name:"config",category:"Core",syntax:["config()","config(options)"],description:"Get configuration or change configuration.",examples:["config()","1/3 + 1/4",'config({number: "Fraction"})',"1/3 + 1/4"],seealso:[]}},function(e,t){e.exports={name:"import",category:"Core",syntax:["import(functions)","import(functions, options)"],description:"Import functions or constants from an object.",examples:["import({myFn: f(x)=x^2, myConstant: 32 })","myFn(2)","myConstant"],seealso:[]}},function(e,t){e.exports={name:"typed",category:"Core",syntax:["typed(signatures)","typed(name, signatures)"],description:"Create a typed function.",examples:['double = typed({ "number, number": f(x)=x+x })',"double(2)",'double("hello")'],seealso:[]}},function(e,t){e.exports={name:"arg",category:"Complex",syntax:["arg(x)"],description:"Compute the argument of a complex value. If x = a+bi, the argument is computed as atan2(b, a).",examples:["arg(2 + 2i)","atan2(3, 2)","arg(2 + 3i)"],seealso:["re","im","conj","abs"]}},function(e,t){e.exports={name:"conj",category:"Complex",syntax:["conj(x)"],description:"Compute the complex conjugate of a complex value. If x = a+bi, the complex conjugate is a-bi.",examples:["conj(2 + 3i)","conj(2 - 3i)","conj(-5.2i)"],seealso:["re","im","abs","arg"]}},function(e,t){e.exports={name:"re",category:"Complex",syntax:["re(x)"],description:"Get the real part of a complex number.",examples:["re(2 + 3i)","im(2 + 3i)","re(-5.2i)","re(2.4)"],seealso:["im","conj","abs","arg"]}},function(e,t){e.exports={name:"im",category:"Complex",syntax:["im(x)"],description:"Get the imaginary part of a complex number.",examples:["im(2 + 3i)","re(2 + 3i)","im(-5.2i)","im(2.4)"],seealso:["re","conj","abs","arg"]}},function(e,t){e.exports={name:"eval",category:"Expression",syntax:["eval(expression)","eval([expr1, expr2, expr3, ...])"],description:"Evaluate an expression or an array with expressions.",examples:['eval("2 + 3")','eval("sqrt(" + 4 + ")")'],seealso:[]}},function(e,t){e.exports={name:"help",category:"Expression",syntax:["help(object)","help(string)"],description:"Display documentation on a function or data type.",examples:["help(sqrt)",'help("complex")'],seealso:[]}},function(e,t){e.exports={name:"distance",category:"Geometry",syntax:["distance([x1, y1], [x2, y2])","distance([[x1, y1], [x2, y2])"],description:"Calculates the Euclidean distance between two points.",examples:["distance([0,0], [4,4])","distance([[0,0], [4,4]])"],seealso:[]}},function(e,t){e.exports={name:"intersect",category:"Geometry",syntax:["intersect(expr1, expr2, expr3, expr4)","intersect(expr1, expr2, expr3)"],description:"Computes the intersection point of lines and/or planes.",examples:["intersect([0, 0], [10, 10], [10, 0], [0, 10])","intersect([1, 0, 1],  [4, -2, 2], [1, 1, 1, 6])"],seealso:[]}},function(e,t){e.exports={name:"and",category:"Logical",syntax:["x and y","and(x, y)"],description:"Logical and. Test whether two values are both defined with a nonzero/nonempty value.",examples:["true and false","true and true","2 and 4"],seealso:["not","or","xor"]}},function(e,t){e.exports={name:"not",category:"Logical",syntax:["not x","not(x)"],description:"Logical not. Flips the boolean value of given argument.",examples:["not true","not false","not 2","not 0"],seealso:["and","or","xor"]}},function(e,t){e.exports={name:"or",category:"Logical",syntax:["x or y","or(x, y)"],description:"Logical or. Test if at least one value is defined with a nonzero/nonempty value.",examples:["true or false","false or false","0 or 4"],seealso:["not","and","xor"]}},function(e,t){e.exports={name:"xor",category:"Logical",syntax:["x or y","or(x, y)"],description:"Logical exclusive or, xor. Test whether one and only one value is defined with a nonzero/nonempty value.",examples:["true xor false","false xor false","true xor true","0 or 4"],seealso:["not","and","or"]}},function(e,t){e.exports={name:"concat",category:"Matrix",syntax:["concat(A, B, C, ...)","concat(A, B, C, ..., dim)"],description:"Concatenate matrices. By default, the matrices are concatenated by the last dimension. The dimension on which to concatenate can be provided as last argument.",examples:["A = [1, 2; 5, 6]","B = [3, 4; 7, 8]","concat(A, B)","concat(A, B, 1)","concat(A, B, 2)"],seealso:["det","diag","eye","inv","ones","range","size","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"cross",category:"Matrix",syntax:["cross(A, B)"],description:"Calculate the cross product for two vectors in three dimensional space.",examples:["cross([1, 1, 0],  [0, 1, 1])","cross([3, -3, 1], [4, 9, 2])","cross([2, 3, 4],  [5, 6, 7])"],seealso:["multiply","dot"]}},function(e,t){e.exports={name:"det",category:"Matrix",syntax:["det(x)"],description:"Calculate the determinant of a matrix",examples:["det([1, 2; 3, 4])","det([-2, 2, 3; -1, 1, 3; 2, 0, -1])"],seealso:["concat","diag","eye","inv","ones","range","size","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"diag",category:"Matrix",syntax:["diag(x)","diag(x, k)"],description:"Create a diagonal matrix or retrieve the diagonal of a matrix. When x is a vector, a matrix with the vector values on the diagonal will be returned. When x is a matrix, a vector with the diagonal values of the matrix is returned. When k is provided, the k-th diagonal will be filled in or retrieved, if k is positive, the values are placed on the super diagonal. When k is negative, the values are placed on the sub diagonal.",examples:["diag(1:3)","diag(1:3, 1)","a = [1, 2, 3; 4, 5, 6; 7, 8, 9]","diag(a)"],seealso:["concat","det","eye","inv","ones","range","size","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"dot",category:"Matrix",syntax:["dot(A, B)"],description:"Calculate the dot product of two vectors. The dot product of A = [a1, a2, a3, ..., an] and B = [b1, b2, b3, ..., bn] is defined as dot(A, B) = a1 * b1 + a2 * b2 + a3 * b3 + ... + an * bn",examples:["dot([2, 4, 1], [2, 2, 3])","[2, 4, 1] * [2, 2, 3]"],seealso:["multiply","cross"]}},function(e,t){e.exports={name:"eye",category:"Matrix",syntax:["eye(n)","eye(m, n)","eye([m, n])","eye"],description:"Returns the identity matrix with size m-by-n. The matrix has ones on the diagonal and zeros elsewhere.",examples:["eye(3)","eye(3, 5)","a = [1, 2, 3; 4, 5, 6]","eye(size(a))"],seealso:["concat","det","diag","inv","ones","range","size","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"filter",category:"Matrix",syntax:["filter(x, test)"],description:"Filter items in a matrix.",examples:["isPositive(x) = x > 0","filter([6, -2, -1, 4, 3], isPositive)","filter([6, -2, 0, 1, 0], x != 0)"],seealso:["sort","map","forEach"]}},function(e,t){e.exports={name:"flatten",category:"Matrix",syntax:["flatten(x)"],description:"Flatten a multi dimensional matrix into a single dimensional matrix.",examples:["a = [1, 2, 3; 4, 5, 6]","size(a)","b = flatten(a)","size(b)"],seealso:["concat","resize","size","squeeze"]}},function(e,t){e.exports={name:"forEach",category:"Matrix",syntax:["forEach(x, callback)"],description:"Iterates over all elements of a matrix/array, and executes the given callback function.",examples:["forEach([1, 2, 3], function(val) { console.log(val) })"],seealso:["map","sort","filter"]}},function(e,t){e.exports={name:"inv",category:"Matrix",syntax:["inv(x)"],description:"Calculate the inverse of a matrix",examples:["inv([1, 2; 3, 4])","inv(4)","1 / 4"],seealso:["concat","det","diag","eye","ones","range","size","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"map",category:"Matrix",syntax:["map(x, callback)"],description:"Create a new matrix or array with the results of the callback function executed on each entry of the matrix/array.",examples:["map([1, 2, 3], function(val) { return value * value })"],seealso:["filter","forEach"]}},function(e,t){e.exports={name:"ones",category:"Matrix",syntax:["ones(m)","ones(m, n)","ones(m, n, p, ...)","ones([m])","ones([m, n])","ones([m, n, p, ...])","ones"],description:"Create a matrix containing ones.",examples:["ones(3)","ones(3, 5)","ones([2,3]) * 4.5","a = [1, 2, 3; 4, 5, 6]","ones(size(a))"],seealso:["concat","det","diag","eye","inv","range","size","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"partitionSelect",category:"Matrix",syntax:["partitionSelect(x, k)","partitionSelect(x, k, compare)"],description:"Partition-based selection of an array or 1D matrix. Will find the kth smallest value, and mutates the input array. Uses Quickselect.",examples:["partitionSelect([5, 10, 1], 2)",'partitionSelect(["C", "B", "A", "D"], 1)'],seealso:["sort"]}},function(e,t){e.exports={name:"range",category:"Type",syntax:["start:end","start:step:end","range(start, end)","range(start, end, step)","range(string)"],description:"Create a range. Lower bound of the range is included, upper bound is excluded.",examples:["1:5","3:-1:-3","range(3, 7)","range(0, 12, 2)",'range("4:10")',"a = [1, 2, 3, 4; 5, 6, 7, 8]","a[1:2, 1:2]"],seealso:["concat","det","diag","eye","inv","ones","size","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"resize",category:"Matrix",syntax:["resize(x, size)","resize(x, size, defaultValue)"],description:"Resize a matrix.",examples:["resize([1,2,3,4,5], [3])","resize([1,2,3], [5])","resize([1,2,3], [5], -1)","resize(2, [2, 3])",'resize("hello", [8], "!")'],seealso:["size","subset","squeeze"]}},function(e,t){e.exports={name:"size",category:"Matrix",syntax:["size(x)"],description:"Calculate the size of a matrix.",examples:["size(2.3)",'size("hello world")',"a = [1, 2; 3, 4; 5, 6]","size(a)","size(1:6)"],seealso:["concat","det","diag","eye","inv","ones","range","squeeze","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"sort",category:"Matrix",syntax:["sort(x)","sort(x, compare)"],description:'Sort the items in a matrix. Compare can be a string "asc" or "desc", or a custom sort function.',examples:["sort([5, 10, 1])",'sort(["C", "B", "A", "D"])',"sortByLength(a, b) = size(a)[1] - size(b)[1]",'sort(["Langdon", "Tom", "Sara"], sortByLength)'],seealso:["map","filter","forEach"]}},function(e,t){e.exports={name:"squeeze",category:"Matrix",syntax:["squeeze(x)"],description:"Remove inner and outer singleton dimensions from a matrix.",examples:["a = zeros(3,2,1)","size(squeeze(a))","b = zeros(1,1,3)","size(squeeze(b))"],seealso:["concat","det","diag","eye","inv","ones","range","size","subset","trace","transpose","zeros"]}},function(e,t){e.exports={name:"subset",category:"Matrix",syntax:["value(index)","value(index) = replacement","subset(value, [index])","subset(value, [index], replacement)"],description:"Get or set a subset of a matrix or string. Indexes are one-based. Both the ranges lower-bound and upper-bound are included.",examples:["d = [1, 2; 3, 4]","e = []","e[1, 1:2] = [5, 6]","e[2, :] = [7, 8]","f = d * e","f[2, 1]","f[:, 1]"],seealso:["concat","det","diag","eye","inv","ones","range","size","squeeze","trace","transpose","zeros"]}},function(e,t){e.exports={name:"trace",category:"Matrix",syntax:["trace(A)"],description:"Calculate the trace of a matrix: the sum of the elements on the main diagonal of a square matrix.",examples:["A = [1, 2, 3; -1, 2, 3; 2, 0, 3]","trace(A)"],seealso:["concat","det","diag","eye","inv","ones","range","size","squeeze","subset","transpose","zeros"]}},function(e,t){e.exports={name:"transpose",category:"Matrix",syntax:["x'","transpose(x)"],description:"Transpose a matrix",examples:["a = [1, 2, 3; 4, 5, 6]","a'","transpose(a)"],seealso:["concat","det","diag","eye","inv","ones","range","size","squeeze","subset","trace","zeros"]}},function(e,t){e.exports={name:"zeros",category:"Matrix",syntax:["zeros(m)","zeros(m, n)","zeros(m, n, p, ...)","zeros([m])","zeros([m, n])","zeros([m, n, p, ...])","zeros"],description:"Create a matrix containing zeros.",examples:["zeros(3)","zeros(3, 5)","a = [1, 2, 3; 4, 5, 6]","zeros(size(a))"],seealso:["concat","det","diag","eye","inv","ones","range","size","squeeze","subset","trace","transpose"]}},function(e,t){e.exports={name:"combinations",category:"Probability",syntax:["combinations(n, k)"],description:"Compute the number of combinations of n items taken k at a time",examples:["combinations(7, 5)"],seealso:["permutations","factorial"]}},function(e,t){e.exports={name:"factorial",category:"Probability",syntax:["kldivergence(x, y)"],description:"Compute the factorial of a value",examples:["5!","5 * 4 * 3 * 2 * 1","3!"],seealso:["combinations","permutations","gamma"]}},function(e,t){e.exports={name:"gamma",category:"Probability",syntax:["gamma(n)"],description:"Compute the gamma function. For small values, the Lanczos approximation is used, and for large values the extended Stirling approximation.",examples:["gamma(4)","3!","gamma(1/2)","sqrt(pi)"],seealso:["factorial"]}},function(e,t){e.exports={name:"kldivergence",category:"Probability",syntax:["n!","factorial(n)"],description:"Calculate the Kullback-Leibler (KL) divergence  between two distributions.",examples:["math.kldivergence([0.7,0.5,0.4], [0.2,0.9,0.5])"],seealso:[]}},function(e,t){e.exports={name:"multinomial",category:"Probability",syntax:["multinomial(A)"],description:"Multinomial Coefficients compute the number of ways of picking a1, a2, ..., ai unordered outcomes from `n` possibilities. multinomial takes one array of integers as an argument. The following condition must be enforced: every ai <= 0.",examples:["multinomial([1, 2, 1])"],seealso:["combinations","factorial"]}},function(e,t){e.exports={name:"permutations",category:"Probability",syntax:["permutations(n)","permutations(n, k)"],description:"Compute the number of permutations of n items taken k at a time",examples:["permutations(5)","permutations(5, 3)"],seealso:["combinations","factorial"]}},function(e,t){e.exports={name:"pickRandom",category:"Probability",syntax:["pickRandom(array)"],description:"Pick a random entry from a given array.",examples:["pickRandom(0:10)","pickRandom([1, 3, 1, 6])"],seealso:["random","randomInt"]}},function(e,t){e.exports={name:"random",category:"Probability",syntax:["random()","random(max)","random(min, max)","random(size)","random(size, max)","random(size, min, max)"],description:"Return a random number.",examples:["random()","random(10, 20)","random([2, 3])"],seealso:["pickRandom","randomInt"]}},function(e,t){e.exports={name:"randInt",category:"Probability",syntax:["randInt(max)","randInt(min, max)","randInt(size)","randInt(size, max)","randInt(size, min, max)"],description:"Return a random integer number",examples:["randInt(10, 20)","randInt([2, 3], 10)"],seealso:["pickRandom","random"]}},function(e,t){e.exports={name:"compare",category:"Relational",syntax:["compare(x, y)"],description:"Compare two values. Returns 1 if x is larger than y, -1 if x is smaller than y, and 0 if x and y are equal.",examples:["compare(2, 3)","compare(3, 2)","compare(2, 2)","compare(5cm, 40mm)","compare(2, [1, 2, 3])"],seealso:["equal","unequal","smaller","smallerEq","largerEq"]}},function(e,t){e.exports={name:"deepEqual",category:"Relational",syntax:["deepEqual(x, y)"],description:"Check equality of two matrices element wise. Returns true if the size of both matrices is equal and when and each of the elements are equal.",examples:["[1,3,4] == [1,3,4]","[1,3,4] == [1,3]"],seealso:["equal","unequal","smaller","larger","smallerEq","largerEq","compare"]}},function(e,t){e.exports={name:"equal",category:"Relational",syntax:["x == y","equal(x, y)"],description:"Check equality of two values. Returns true if the values are equal, and false if not.",examples:["2+2 == 3","2+2 == 4","a = 3.2","b = 6-2.8","a == b","50cm == 0.5m"],seealso:["unequal","smaller","larger","smallerEq","largerEq","compare","deepEqual"]}},function(e,t){e.exports={name:"larger",category:"Relational",syntax:["x > y","larger(x, y)"],description:"Check if value x is larger than y. Returns true if x is larger than y, and false if not.",examples:["2 > 3","5 > 2*2","a = 3.3","b = 6-2.8","(a > b)","(b < a)","5 cm > 2 inch"],seealso:["equal","unequal","smaller","smallerEq","largerEq","compare"]}},function(e,t){e.exports={name:"largerEq",category:"Relational",syntax:["x >= y","largerEq(x, y)"],description:"Check if value x is larger or equal to y. Returns true if x is larger or equal to y, and false if not.",examples:["2 > 1+1","2 >= 1+1","a = 3.2","b = 6-2.8","(a > b)"],seealso:["equal","unequal","smallerEq","smaller","largerEq","compare"]}},function(e,t){e.exports={name:"smaller",category:"Relational",syntax:["x < y","smaller(x, y)"],description:"Check if value x is smaller than value y. Returns true if x is smaller than y, and false if not.",examples:["2 < 3","5 < 2*2","a = 3.3","b = 6-2.8","(a < b)","5 cm < 2 inch"],seealso:["equal","unequal","larger","smallerEq","largerEq","compare"]}},function(e,t){e.exports={name:"smallerEq",category:"Relational",syntax:["x <= y","smallerEq(x, y)"],description:"Check if value x is smaller or equal to value y. Returns true if x is smaller than y, and false if not.",examples:["2 < 1+1","2 <= 1+1","a = 3.2","b = 6-2.8","(a < b)"],seealso:["equal","unequal","larger","smaller","largerEq","compare"]}},function(e,t){e.exports={name:"unequal",category:"Relational",syntax:["x != y","unequal(x, y)"],description:"Check unequality of two values. Returns true if the values are unequal, and false if they are equal.",examples:["2+2 != 3","2+2 != 4","a = 3.2","b = 6-2.8","a != b","50cm != 0.5m","5 cm != 2 inch"],seealso:["equal","smaller","larger","smallerEq","largerEq","compare","deepEqual"]}},function(e,t){e.exports={name:"max",category:"Statistics",syntax:["max(a, b, c, ...)","max(A)","max(A, dim)"],description:"Compute the maximum value of a list of values.",examples:["max(2, 3, 4, 1)","max([2, 3, 4, 1])","max([2, 5; 4, 3])","max([2, 5; 4, 3], 1)","max([2, 5; 4, 3], 2)","max(2.7, 7.1, -4.5, 2.0, 4.1)","min(2.7, 7.1, -4.5, 2.0, 4.1)"],seealso:["mean","median","min","prod","std","sum","var"]}},function(e,t){e.exports={name:"mean",category:"Statistics",syntax:["mean(a, b, c, ...)","mean(A)","mean(A, dim)"],description:"Compute the arithmetic mean of a list of values.",examples:["mean(2, 3, 4, 1)","mean([2, 3, 4, 1])","mean([2, 5; 4, 3])","mean([2, 5; 4, 3], 1)","mean([2, 5; 4, 3], 2)","mean([1.0, 2.7, 3.2, 4.0])"],seealso:["max","median","min","prod","std","sum","var"]}},function(e,t){e.exports={name:"median",category:"Statistics",syntax:["median(a, b, c, ...)","median(A)"],description:"Compute the median of all values. The values are sorted and the middle value is returned. In case of an even number of values, the average of the two middle values is returned.",examples:["median(5, 2, 7)","median([3, -1, 5, 7])"],seealso:["max","mean","min","prod","std","sum","var"]}},function(e,t){e.exports={name:"min",category:"Statistics",syntax:["min(a, b, c, ...)","min(A)","min(A, dim)"],description:"Compute the minimum value of a list of values.",examples:["min(2, 3, 4, 1)","min([2, 3, 4, 1])","min([2, 5; 4, 3])","min([2, 5; 4, 3], 1)","min([2, 5; 4, 3], 2)","min(2.7, 7.1, -4.5, 2.0, 4.1)","max(2.7, 7.1, -4.5, 2.0, 4.1)"],seealso:["max","mean","median","prod","std","sum","var"]}},function(e,t){e.exports={name:"mode",category:"Statistics",syntax:["mode(a, b, c, ...)","mode(A)","mode(A, a, b, B, c, ...)"],description:"Computes the mode of all values as an array. In case mode being more than one, multiple values are returned in an array.",examples:["mode(5, 2, 7)","mode([3, -1, 5, 7])"],seealso:["max","mean","min","median","prod","std","sum","var"]}},function(e,t){e.exports={name:"prod",category:"Statistics",syntax:["prod(a, b, c, ...)","prod(A)"],description:"Compute the product of all values.",examples:["prod(2, 3, 4)","prod([2, 3, 4])","prod([2, 5; 4, 3])"],seealso:["max","mean","min","median","min","std","sum","var"]}},function(e,t){e.exports={name:"quantileSeq",category:"Statistics",syntax:["quantileSeq(A, prob[, sorted])","quantileSeq(A, [prob1, prob2, ...][, sorted])","quantileSeq(A, N[, sorted])"],description:"Compute the prob order quantile of a matrix or a list with values. The sequence is sorted and the middle value is returned. Supported types of sequence values are: Number, BigNumber, Unit Supported types of probablity are: Number, BigNumber. \n\nIn case of a (multi dimensional) array or matrix, the prob order quantile of all elements will be calculated.",examples:["quantileSeq([3, -1, 5, 7], 0.5)","quantileSeq([3, -1, 5, 7], [1/3, 2/3])","quantileSeq([3, -1, 5, 7], 2)","quantileSeq([-1, 3, 5, 7], 0.5, true)"],seealso:["mean","median","min","max","prod","std","sum","var"]}},function(e,t){e.exports={name:"std",category:"Statistics",syntax:["std(a, b, c, ...)","std(A)","std(A, normalization)"],description:'Compute the standard deviation of all values, defined as std(A) = sqrt(var(A)). Optional parameter normalization can be "unbiased" (default), "uncorrected", or "biased".',examples:["std(2, 4, 6)","std([2, 4, 6, 8])",'std([2, 4, 6, 8], "uncorrected")','std([2, 4, 6, 8], "biased")',"std([1, 2, 3; 4, 5, 6])"],seealso:["max","mean","min","median","min","prod","sum","var"]}},function(e,t){e.exports={name:"sum",category:"Statistics",syntax:["sum(a, b, c, ...)","sum(A)"],description:"Compute the sum of all values.",examples:["sum(2, 3, 4, 1)","sum([2, 3, 4, 1])","sum([2, 5; 4, 3])"],seealso:["max","mean","median","min","prod","std","sum","var"]}},function(e,t){e.exports={name:"var",category:"Statistics",syntax:["var(a, b, c, ...)","var(A)","var(A, normalization)"],description:'Compute the variance of all values. Optional parameter normalization can be "unbiased" (default), "uncorrected", or "biased".',examples:["var(2, 4, 6)","var([2, 4, 6, 8])",'var([2, 4, 6, 8], "uncorrected")','var([2, 4, 6, 8], "biased")',"var([1, 2, 3; 4, 5, 6])"],seealso:["max","mean","min","median","min","prod","std","sum"]}},function(e,t){e.exports={name:"acos",category:"Trigonometry",syntax:["acos(x)"],description:"Compute the inverse cosine of a value in radians.",examples:["acos(0.5)","acos(cos(2.3))"],seealso:["cos","atan","asin"]}},function(e,t){e.exports={name:"acosh",category:"Trigonometry",syntax:["acosh(x)"],description:"Calculate the hyperbolic arccos of a value, defined as `acosh(x) = ln(sqrt(x^2 - 1) + x)`.",examples:["acosh(1.5)"],seealso:["cosh","asinh","atanh"]}},function(e,t){e.exports={name:"acot",category:"Trigonometry",syntax:["acot(x)"],description:"Calculate the inverse cotangent of a value.",examples:["acot(0.5)","acot(cot(0.5))","acot(2)"],seealso:["cot","atan"]}},function(e,t){e.exports={name:"acoth",category:"Trigonometry",syntax:["acoth(x)"],description:"Calculate the hyperbolic arccotangent of a value, defined as `acoth(x) = (ln((x+1)/x) + ln(x/(x-1))) / 2`.",examples:["acoth(0.5)"],seealso:["acsch","asech"]}},function(e,t){e.exports={name:"acsc",
category:"Trigonometry",syntax:["acsc(x)"],description:"Calculate the inverse cotangent of a value.",examples:["acsc(0.5)","acsc(csc(0.5))","acsc(2)"],seealso:["csc","asin","asec"]}},function(e,t){e.exports={name:"acsch",category:"Trigonometry",syntax:["acsch(x)"],description:"Calculate the hyperbolic arccosecant of a value, defined as `acsch(x) = ln(1/x + sqrt(1/x^2 + 1))`.",examples:["acsch(0.5)"],seealso:["asech","acoth"]}},function(e,t){e.exports={name:"asec",category:"Trigonometry",syntax:["asec(x)"],description:"Calculate the inverse secant of a value.",examples:["asec(0.5)","asec(sec(0.5))","asec(2)"],seealso:["acos","acot","acsc"]}},function(e,t){e.exports={name:"asech",category:"Trigonometry",syntax:["asech(x)"],description:"Calculate the inverse secant of a value.",examples:["asech(0.5)"],seealso:["acsch","acoth"]}},function(e,t){e.exports={name:"asin",category:"Trigonometry",syntax:["asin(x)"],description:"Compute the inverse sine of a value in radians.",examples:["asin(0.5)","asin(sin(2.3))"],seealso:["sin","acos","atan"]}},function(e,t){e.exports={name:"asinh",category:"Trigonometry",syntax:["asinh(x)"],description:"Calculate the hyperbolic arcsine of a value, defined as `asinh(x) = ln(x + sqrt(x^2 + 1))`.",examples:["asinh(0.5)"],seealso:["acosh","atanh"]}},function(e,t){e.exports={name:"atan",category:"Trigonometry",syntax:["atan(x)"],description:"Compute the inverse tangent of a value in radians.",examples:["atan(0.5)","atan(tan(2.3))"],seealso:["tan","acos","asin"]}},function(e,t){e.exports={name:"atanh",category:"Trigonometry",syntax:["atanh(x)"],description:"Calculate the hyperbolic arctangent of a value, defined as `atanh(x) = ln((1 + x)/(1 - x)) / 2`.",examples:["atanh(0.5)"],seealso:["acosh","asinh"]}},function(e,t){e.exports={name:"atan2",category:"Trigonometry",syntax:["atan2(y, x)"],description:"Computes the principal value of the arc tangent of y/x in radians.",examples:["atan2(2, 2) / pi","angle = 60 deg in rad","x = cos(angle)","y = sin(angle)","atan2(y, x)"],seealso:["sin","cos","tan"]}},function(e,t){e.exports={name:"cos",category:"Trigonometry",syntax:["cos(x)"],description:"Compute the cosine of x in radians.",examples:["cos(2)","cos(pi / 4) ^ 2","cos(180 deg)","cos(60 deg)","sin(0.2)^2 + cos(0.2)^2"],seealso:["acos","sin","tan"]}},function(e,t){e.exports={name:"cosh",category:"Trigonometry",syntax:["cosh(x)"],description:"Compute the hyperbolic cosine of x in radians.",examples:["cosh(0.5)"],seealso:["sinh","tanh","coth"]}},function(e,t){e.exports={name:"cot",category:"Trigonometry",syntax:["cot(x)"],description:"Compute the cotangent of x in radians. Defined as 1/tan(x)",examples:["cot(2)","1 / tan(2)"],seealso:["sec","csc","tan"]}},function(e,t){e.exports={name:"coth",category:"Trigonometry",syntax:["coth(x)"],description:"Compute the hyperbolic cotangent of x in radians.",examples:["coth(2)","1 / tanh(2)"],seealso:["sech","csch","tanh"]}},function(e,t){e.exports={name:"csc",category:"Trigonometry",syntax:["csc(x)"],description:"Compute the cosecant of x in radians. Defined as 1/sin(x)",examples:["csc(2)","1 / sin(2)"],seealso:["sec","cot","sin"]}},function(e,t){e.exports={name:"csch",category:"Trigonometry",syntax:["csch(x)"],description:"Compute the hyperbolic cosecant of x in radians. Defined as 1/sinh(x)",examples:["csch(2)","1 / sinh(2)"],seealso:["sech","coth","sinh"]}},function(e,t){e.exports={name:"sec",category:"Trigonometry",syntax:["sec(x)"],description:"Compute the secant of x in radians. Defined as 1/cos(x)",examples:["sec(2)","1 / cos(2)"],seealso:["cot","csc","cos"]}},function(e,t){e.exports={name:"sech",category:"Trigonometry",syntax:["sech(x)"],description:"Compute the hyperbolic secant of x in radians. Defined as 1/cosh(x)",examples:["sech(2)","1 / cosh(2)"],seealso:["coth","csch","cosh"]}},function(e,t){e.exports={name:"sin",category:"Trigonometry",syntax:["sin(x)"],description:"Compute the sine of x in radians.",examples:["sin(2)","sin(pi / 4) ^ 2","sin(90 deg)","sin(30 deg)","sin(0.2)^2 + cos(0.2)^2"],seealso:["asin","cos","tan"]}},function(e,t){e.exports={name:"sinh",category:"Trigonometry",syntax:["sinh(x)"],description:"Compute the hyperbolic sine of x in radians.",examples:["sinh(0.5)"],seealso:["cosh","tanh"]}},function(e,t){e.exports={name:"tan",category:"Trigonometry",syntax:["tan(x)"],description:"Compute the tangent of x in radians.",examples:["tan(0.5)","sin(0.5) / cos(0.5)","tan(pi / 4)","tan(45 deg)"],seealso:["atan","sin","cos"]}},function(e,t){e.exports={name:"tanh",category:"Trigonometry",syntax:["tanh(x)"],description:"Compute the hyperbolic tangent of x in radians.",examples:["tanh(0.5)","sinh(0.5) / cosh(0.5)"],seealso:["sinh","cosh"]}},function(e,t){e.exports={name:"to",category:"Units",syntax:["x to unit","to(x, unit)"],description:"Change the unit of a value.",examples:["5 inch to cm","3.2kg to g","16 bytes in bits"],seealso:[]}},function(e,t){e.exports={name:"clone",category:"Utils",syntax:["clone(x)"],description:"Clone a variable. Creates a copy of primitive variables,and a deep copy of matrices",examples:["clone(3.5)","clone(2 - 4i)","clone(45 deg)","clone([1, 2; 3, 4])",'clone("hello world")'],seealso:[]}},function(e,t){e.exports={name:"format",category:"Utils",syntax:["format(value)","format(value, precision)"],description:"Format a value of any type as string.",examples:["format(2.3)","format(3 - 4i)","format([])","format(pi, 3)"],seealso:["print"]}},function(e,t){e.exports={name:"isInteger",category:"Utils",syntax:["isInteger(x)"],description:"Test whether a value is an integer number.",examples:["isInteger(2)","isInteger(3.5)","isInteger([3, 0.5, -2])"],seealso:["isNegative","isNumeric","isPositive","isZero"]}},function(e,t){e.exports={name:"isNegative",category:"Utils",syntax:["isNegative(x)"],description:"Test whether a value is negative: smaller than zero.",examples:["isNegative(2)","isNegative(0)","isNegative(-4)","isNegative([3, 0.5, -2])"],seealso:["isInteger","isNumeric","isPositive","isZero"]}},function(e,t){e.exports={name:"isNumeric",category:"Utils",syntax:["isNumeric(x)"],description:"Test whether a value is a numeric value. Returns true when the input is a number, BigNumber, Fraction, or boolean.",examples:["isNumeric(2)","isNumeric(0)","isNumeric(bignumber(500))","isNumeric(fraction(0.125))",'isNumeric("3")',"isNumeric(2 + 3i)",'isNumeric([2.3, "foo", false])'],seealso:["isInteger","isZero","isNegative","isPositive"]}},function(e,t){e.exports={name:"isPositive",category:"Utils",syntax:["isPositive(x)"],description:"Test whether a value is positive: larger than zero.",examples:["isPositive(2)","isPositive(0)","isPositive(-4)","isPositive([3, 0.5, -2])"],seealso:["isInteger","isNumeric","isNegative","isZero"]}},function(e,t){e.exports={name:"isZero",category:"Utils",syntax:["isZero(x)"],description:"Test whether a value is zero.",examples:["isZero(2)","isZero(0)","isZero(-4)","isZero([3, 0, -2, 0])"],seealso:["isInteger","isNumeric","isNegative","isPositive"]}},function(e,t){e.exports={name:"typeof",category:"Utils",syntax:["typeof(x)"],description:"Get the type of a variable.",examples:["typeof(3.5)","typeof(2 - 4i)","typeof(45 deg)",'typeof("hello world")'],seealso:[]}},function(e,t,r){e.exports=[r(269),r(292),r(293),r(294),r(295)]},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(270));return a("compile",{string:function(e){return o(e).compile()},"Array | Matrix":function(e){return i(e,function(e){return o(e).compile()})}})}var i=r(19);t.name="compile",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(t,r){if(1!=arguments.length&&2!=arguments.length)throw new i("parse",arguments.length,1,2);if(de=r&&r.nodes?r.nodes:{},"string"==typeof t)return ge=t,x();if(Array.isArray(t)||t instanceof e.Matrix)return a(t,function(e){if("string"!=typeof e)throw new TypeError("String expected");return ge=e,x()});throw new TypeError("String or matrix expected")}function u(){ve=0,ye=ge.charAt(0),we=0,Ne=null}function c(){ve++,ye=ge.charAt(ve)}function f(){return ge.charAt(ve+1)}function l(){return ge.charAt(ve+2)}function p(){for(be=pe.NULL,xe="";" "==ye||"	"==ye||"\n"==ye&&we;)c();if("#"==ye)for(;"\n"!=ye&&""!=ye;)c();if(""==ye)return void(be=pe.DELIMITER);if("\n"==ye&&!we)return be=pe.DELIMITER,xe=ye,void c();var e=ye+f(),t=e+l();if(3==t.length&&he[t])return be=pe.DELIMITER,xe=t,c(),c(),void c();if(2==e.length&&he[e])return be=pe.DELIMITER,xe=e,c(),void c();if(he[ye])return be=pe.DELIMITER,xe=ye,void c();if(!v(ye)){if(g()){for(;g()||y(ye);)xe+=ye,c();return void(be=me.hasOwnProperty(xe)?pe.DELIMITER:pe.SYMBOL)}for(be=pe.UNKNOWN;""!=ye;)xe+=ye,c();throw X('Syntax error in part "'+xe+'"')}if(be=pe.NUMBER,"."==ye)xe+=ye,c(),y(ye)||(be=pe.UNKNOWN);else{for(;y(ye);)xe+=ye,c();"."==ye&&(xe+=ye,c())}for(;y(ye);)xe+=ye,c();if(e=f(),"E"==ye||"e"==ye)if(y(e)||"-"==e||"+"==e){if(xe+=ye,c(),"+"!=ye&&"-"!=ye||(xe+=ye,c()),!y(ye))throw X('Digit expected, got "'+ye+'"');for(;y(ye);)xe+=ye,c();if("."==ye)throw X('Digit expected, got "'+ye+'"')}else if("."==e)throw c(),X('Digit expected, got "'+ye+'"')}function h(){do p();while("\n"==xe)}function m(){we++}function d(){we--}function g(){var e=ge.charAt(ve-1),t=ge.charAt(ve+1),r=function(e){return/^[a-zA-Z_\u00C0-\u02AF\u0370-\u03FF]$/.test(e)},n=function(e,t){return/^[\uD835]$/.test(e)&&/^[\uDC00-\uDFFF]$/.test(t)&&/^[^\uDC55\uDC9D\uDCA0\uDCA1\uDCA3\uDCA4\uDCA7\uDCA8\uDCAD\uDCBA\uDCBC\uDCC4\uDD06\uDD0B\uDD0C\uDD15\uDD1D\uDD3A\uDD3F\uDD45\uDD47-\uDD49\uDD51\uDEA6\uDEA7\uDFCC\uDFCD]$/.test(t)};return r(ye)||n(ye,t)||n(e,ye)}function v(e){return e>="0"&&"9">=e||"."==e}function y(e){return e>="0"&&"9">=e}function x(){u(),p();var e=b();if(""!=xe)throw be==pe.DELIMITER?J("Unexpected operator "+xe):X('Unexpected part "'+xe+'"');return e}function b(){var e,t,r=[];if(""==xe)return new ne("undefined","undefined");for("\n"!=xe&&";"!=xe&&(e=w());"\n"==xe||";"==xe;)0==r.length&&e&&(t=";"!=xe,r.push({node:e,visible:t})),p(),"\n"!=xe&&";"!=xe&&""!=xe&&(e=w(),t=";"!=xe,r.push({node:e,visible:t}));return r.length>0?new te(r):e}function w(){var e,t,r,n,i=N();if("="==xe){if(i&&i.isSymbolNode)return e=i.name,h(),r=w(),new ee(new le(e),r);if(i&&i.isAccessorNode)return h(),r=w(),new ee(i.object,i.index,r);if(i&&i.isFunctionNode&&(n=!0,t=[],e=i.name,i.args.forEach(function(e,r){e&&e.isSymbolNode?t[r]=e.name:n=!1}),n))return h(),r=w(),new ie(e,t,r);throw X("Invalid left hand side of assignment operator =")}return i}function N(){for(var e=E();"?"==xe;){var t=Ne;Ne=we,h();var r=e,n=w();if(":"!=xe)throw X("False part of conditional expression expected");Ne=null,h();var i=w();e=new re(r,n,i),Ne=t}return e}function E(){for(var e=M();"or"==xe;)h(),e=new se("or","or",[e,M()]);return e}function M(){for(var e=A();"xor"==xe;)h(),e=new se("xor","xor",[e,A()]);return e}function A(){for(var e=_();"and"==xe;)h(),e=new se("and","and",[e,_()]);return e}function _(){for(var e=O();"|"==xe;)h(),e=new se("|","bitOr",[e,O()]);return e}function O(){for(var e=T();"^|"==xe;)h(),e=new se("^|","bitXor",[e,T()]);return e}function T(){for(var e=C();"&"==xe;)h(),e=new se("&","bitAnd",[e,C()]);return e}function C(){var e,t,r,n,i;for(e=S(),t={"==":"equal","!=":"unequal","<":"smaller",">":"larger","<=":"smallerEq",">=":"largerEq"};xe in t;)r=xe,n=t[r],h(),i=[e,S()],e=new se(r,n,i);return e}function S(){var e,t,r,n,i;for(e=z(),t={"<<":"leftShift",">>":"rightArithShift",">>>":"rightLogShift"};xe in t;)r=xe,n=t[r],h(),i=[e,z()],e=new se(r,n,i);return e}function z(){var e,t,r,n,i;for(e=B(),t={to:"to","in":"to"};xe in t;)r=xe,n=t[r],h(),"in"===r&&""===xe?e=new se("*","multiply",[e,new le("in")],!0):(i=[e,B()],e=new se(r,n,i));return e}function B(){var e,t=[];if(e=":"==xe?new ne("1","number"):k(),":"==xe&&Ne!==we){for(t.push(e);":"==xe&&t.length<3;)h(),")"==xe||"]"==xe||","==xe||""==xe?t.push(new le("end")):t.push(k());e=3==t.length?new fe(t[0],t[2],t[1]):new fe(t[0],t[1])}return e}function k(){var e,t,r,n,i;for(e=I(),t={"+":"add","-":"subtract"};xe in t;)r=xe,n=t[r],h(),i=[e,I()],e=new se(r,n,i);return e}function I(){var e,t,r,n,i;for(e=R(),t=e,r={"*":"multiply",".*":"dotMultiply","/":"divide","./":"dotDivide","%":"mod",mod:"mod"};;)if(xe in r)n=xe,i=r[n],h(),t=R(),e=new se(n,i,[e,t]);else{if(!(be==pe.SYMBOL||"in"==xe&&e&&e.isConstantNode||be==pe.NUMBER&&!t.isConstantNode||"("==xe))break;t=R(),e=new se("*","multiply",[e,t],!0)}return e}function R(){var e,t,r={"-":"unaryMinus","+":"unaryPlus","~":"bitNot",not:"not"}[xe];return r?(e=xe,h(),t=[R()],new se(e,r,t)):P()}function P(){var e,t,r,n;return e=U(),"^"!=xe&&".^"!=xe||(t=xe,r="^"==t?"pow":"dotPow",h(),n=[e,R()],e=new se(t,r,n)),e}function U(){var e,t,r,n,i;for(e=q(),t={"!":"factorial","'":"transpose"};xe in t;)r=xe,n=t[r],p(),i=[e],e=new se(r,n,i),e=j(e);return e}function q(){var e,t=[];if(be==pe.SYMBOL&&de[xe]){if(e=de[xe],p(),"("==xe){if(t=[],m(),p(),")"!=xe)for(t.push(w());","==xe;)p(),t.push(w());if(")"!=xe)throw X("Parenthesis ) expected");d(),p()}return new e(t)}return L()}function L(){var e,t;return be==pe.SYMBOL||be==pe.DELIMITER&&xe in me?(t=xe,p(),e=new le(t),e=j(e)):F()}function j(e,t){for(var r;!("("!=xe&&"["!=xe&&"."!=xe||t&&-1===t.indexOf(xe));)if(r=[],"("==xe){if(!e.isSymbolNode&&!e.isAccessorNode)return e;if(m(),p(),")"!=xe)for(r.push(w());","==xe;)p(),r.push(w());if(")"!=xe)throw X("Parenthesis ) expected");d(),p(),e=new ce(e,r)}else if("["==xe){if(m(),p(),"]"!=xe)for(r.push(w());","==xe;)p(),r.push(w());if("]"!=xe)throw X("Parenthesis ] expected");d(),p(),e=new Q(e,new ae(r))}else{if(p(),be!=pe.SYMBOL)throw X("Property name expected after dot");r.push(new ne(xe)),p();var n=!0;e=new Q(e,new ae(r,n))}return e}function F(){var e,t;return'"'==xe?(t=D(),e=new ne(t,"string"),e=j(e)):$()}function D(){for(var e="";""!=ye&&'"'!=ye;)"\\"==ye&&(e+=ye,c()),e+=ye,c();if(p(),'"'!=xe)throw X('End of string " expected');return p(),e}function $(){var e,t,r,n;if("["==xe){if(m(),p(),"]"!=xe){var i=G();if(";"==xe){for(r=1,t=[i];";"==xe;)p(),t[r]=G(),r++;if("]"!=xe)throw X("End of matrix ] expected");d(),p(),n=t[0].items.length;for(var a=1;r>a;a++)if(t[a].items.length!=n)throw J("Column dimensions mismatch ("+t[a].items.length+" != "+n+")");e=new K(t)}else{if("]"!=xe)throw X("End of matrix ] expected");d(),p(),e=i}}else d(),p(),e=new K([]);return j(e)}return H()}function G(){for(var e=[w()],t=1;","==xe;)p(),e[t]=w(),t++;return new K(e)}function H(){if("{"==xe){var e,t={};do if(p(),"}"!=xe){if('"'==xe)e=D();else{if(be!=pe.SYMBOL)throw X("Symbol or string expected as object key");e=xe,p()}if(":"!=xe)throw X("Colon : expected after object key");p(),t[e]=w()}while(","==xe);if("}"!=xe)throw X("Comma , or bracket } expected after object value");p();var r=new oe(t);return r=j(r)}return V()}function V(){var e;return be==pe.NUMBER?(e=xe,p(),new ne(e,"number")):Z()}function Z(){var e;if("("==xe){if(m(),p(),e=w(),")"!=xe)throw X("Parenthesis ) expected");return d(),p(),e=new ue(e),e=j(e)}return W()}function W(){throw X(""==xe?"Unexpected end of expression":"Value expected")}function Y(){return ve-xe.length+1}function X(e){var t=Y(),r=new SyntaxError(e+" (char "+t+")");return r["char"]=t,r}function J(e){var t=Y(),r=new SyntaxError(e+" (char "+t+")");return r["char"]=t,r}var Q=n(r(271)),K=n(r(277)),ee=n(r(278)),te=n(r(281)),re=n(r(282)),ne=n(r(283)),ie=n(r(284)),ae=n(r(285)),oe=n(r(288)),se=n(r(289)),ue=n(r(291)),ce=n(r(290)),fe=n(r(286)),le=n(r(287)),pe={NULL:0,DELIMITER:1,NUMBER:2,SYMBOL:3,UNKNOWN:4},he={",":!0,"(":!0,")":!0,"[":!0,"]":!0,"{":!0,"}":!0,'"':!0,";":!0,"+":!0,"-":!0,"*":!0,".*":!0,"/":!0,"./":!0,"%":!0,"^":!0,".^":!0,"~":!0,"!":!0,"&":!0,"|":!0,"^|":!0,"'":!0,"=":!0,":":!0,"?":!0,"==":!0,"!=":!0,"<":!0,">":!0,"<=":!0,">=":!0,"<<":!0,">>":!0,">>>":!0},me={mod:!0,to:!0,"in":!0,and:!0,xor:!0,or:!0,not:!0},de={},ge="",ve=0,ye="",xe="",be=pe.NULL,we=0,Ne=null;return s}var i=r(11),a=r(19);t.name="parse",t.path="expression",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(!e||!e.isNode)throw new TypeError('Node expected for parameter "object"');if(!t||!t.isIndexNode)throw new TypeError('IndexNode expected for parameter "index"');this.object=e||null,this.index=t,Object.defineProperty(this,"name",{get:function(){return this.index?this.index.isObjectProperty()?this.index.getObjectProperty():"":this.object.name||""}.bind(this),set:function(){throw new Error("Cannot assign a new name, name is read-only")}})}function o(e){return!(e.isAccessorNode||e.isArrayNode||e.isConstantNode||e.isFunctionNode||e.isObjectNode||e.isParenthesisNode||e.isSymbolNode)}var s=n(r(272)),u=n(r(274));return a.prototype=new s,a.prototype.type="AccessorNode",a.prototype.isAccessorNode=!0,a.prototype._compile=function(e,t){e.access=u;var r=this.object._compile(e,t),n=this.index._compile(e,t);return this.index.isObjectProperty()?r+'["'+this.index.getObjectProperty()+'"]':this.index.needsSize()?"(function () {  var object = "+r+";  var size = math.size(object).valueOf();  return access(object, "+n+");})()":"access("+r+", "+n+")"},a.prototype.forEach=function(e){e(this.object,"object",this),e(this.index,"index",this)},a.prototype.map=function(e){return new a(this._ifNode(e(this.object,"object",this)),this._ifNode(e(this.index,"index",this)))},a.prototype.clone=function(){return new a(this.object,this.index)},a.prototype._toString=function(e){var t=this.object.toString(e);return o(this.object)&&(t="("+t+")"),t+this.index.toString(e)},a.prototype._toTex=function(e){var t=this.object.toTex(e);return o(this.object)&&(t="\\left("+t+"\\right)"),t+this.index.toTex(e)},a}t.name="AccessorNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n,a){function o(){if(!(this instanceof o))throw new SyntaxError("Constructor must be called with the new operator")}function s(e){for(var t in e)if(e.hasOwnProperty(t)&&t in i)throw new Error('Scope contains an illegal symbol, "'+t+'" is a reserved keyword')}return o.prototype.eval=function(e){return this.compile().eval(e)},o.prototype.type="Node",o.prototype.isNode=!0,o.prototype.compile=function(){if(arguments.length>0)throw new Error("Calling compile(math) is deprecated. Call the function as compile() instead.");var e={math:a.expression.transform,args:{},_validateScope:s},t={},r=this._compile(e,t),n=Object.keys(e).map(function(e){return"    var "+e+' = defs["'+e+'"];'}),i=n.join(" ")+'return {  "eval": function (scope) {    if (scope) _validateScope(scope);    scope = scope || {};    return '+r+";  }};",o=new Function("defs",i);return o(e)},o.prototype._compile=function(e,t){throw new Error("Cannot compile a Node interface")},o.prototype.forEach=function(e){throw new Error("Cannot run forEach on a Node interface")},o.prototype.map=function(e){throw new Error("Cannot run map on a Node interface")},o.prototype._ifNode=function(e){if(!e||!e.isNode)throw new TypeError("Callback function must return a Node");return e},o.prototype.traverse=function(e){function t(e,r){e.forEach(function(e,n,i){r(e,n,i),t(e,r)})}e(this,null,null),t(this,e)},o.prototype.transform=function(e){function t(e,r){return e.map(function(e,n,i){var a=r(e,n,i);return t(a,r)})}var r=e(this,null,null);return t(r,e)},o.prototype.filter=function(e){var t=[];return this.traverse(function(r,n,i){e(r,n,i)&&t.push(r)}),t},o.prototype.find=function(){throw new Error("Function Node.find is deprecated. Use Node.filter instead.")},o.prototype.match=function(){throw new Error("Function Node.match is deprecated. See functions Node.filter, Node.transform, Node.traverse.")},o.prototype.clone=function(){throw new Error("Cannot clone a Node interface")},o.prototype.toString=function(e){var t;if(e&&"object"==typeof e)switch(typeof e.handler){case"object":case"undefined":break;case"function":t=e.handler(this,e);break;default:throw new TypeError("Object or function expected as callback")}return"undefined"!=typeof t?t:this._toString(e)},o.prototype._toString=function(){throw new Error("_toString not implemented for "+this.type)},o.prototype.toTex=function(e){var t;if(e&&"object"==typeof e)switch(typeof e.handler){case"object":case"undefined":break;case"function":t=e.handler(this,e);break;default:throw new TypeError("Object or function expected as callback")}return"undefined"!=typeof t?t:this._toTex(e)},o.prototype._toTex=function(e){throw new Error("_toTex not implemented for "+this.type)},o.prototype.getIdentifier=function(){return this.type},o.prototype.getContent=function(){return this},o}var i=r(273);r(3).extend;t.name="Node",t.path="expression.node",t.math=!0,t.factory=n},function(e,t){"use strict";e.exports={end:!0}},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(276)),s=n(r(52));return function(e,t){try{if(Array.isArray(e))return s(e).subset(t).valueOf();if(e&&"function"==typeof e.subset)return e.subset(t);if("string"==typeof e)return o(e,t);if("object"==typeof e){if(!t.isObjectProperty())throw TypeError("Cannot apply a numeric index as object property");return e[t.getObjectProperty()]}throw new TypeError("Cannot apply index: unsupported type of object")}catch(r){throw i(r)}}}var i=r(275).transform;t.factory=n},function(e,t,r){var n=r(43);t.transform=function(e){return e&&e.isIndexError?new n(e.index+1,e.min+1,void 0!==e.max?e.max+1:void 0):e}},function(e,t,r){"use strict";function n(e,t,n,c){function f(e,t){if(!t||t.isIndex!==!0)throw new TypeError("Index expected");if(1!=t.size().length)throw new u(t.size().length,1);var r=e.length;s(t.min()[0],r),s(t.max()[0],r);var n=t.dimension(0),i="";return n.forEach(function(t){i+=e.charAt(t)}),i}function l(e,t,r,n){if(!t||t.isIndex!==!0)throw new TypeError("Index expected");if(1!=t.size().length)throw new u(t.size().length,1);if(void 0!==n){if("string"!=typeof n||1!==n.length)throw new TypeError("Single character expected as defaultValue")}else n=" ";var i=t.dimension(0),a=i.size()[0];if(a!=r.length)throw new u(i.size()[0],r.length);var o=e.length;s(t.min()[0]),s(t.max()[0]);for(var c=[],f=0;o>f;f++)c[f]=e.charAt(f);if(i.forEach(function(e,t){c[e]=r.charAt(t[0])}),c.length>o)for(f=o-1,a=c.length;a>f;f++)c[f]||(c[f]=n);return c.join("")}var p=n(r(52)),h=c("subset",{"Array, Index":function(e,t){var r=p(e),n=r.subset(t);return n&&n.valueOf()},"Matrix, Index":function(e,t){return e.subset(t)},"Object, Index":i,"string, Index":f,"Array, Index, any":function(e,t,r){return p(o(e)).subset(t,r,void 0).valueOf()},"Array, Index, any, any":function(e,t,r,n){return p(o(e)).subset(t,r,n).valueOf()},"Matrix, Index, any":function(e,t,r){return e.clone().subset(t,r)},"Matrix, Index, any, any":function(e,t,r,n){return e.clone().subset(t,r,n)},"string, Index, string":l,"string, Index, string, string":l,"Object, Index, any":a});return h.toTex=void 0,h}function i(e,t){if(1!==t.size().length)throw new u(t.size(),1);var r=t.dimension(0);if("string"!=typeof r)throw new TypeError("String expected as index to retrieve an object property");return e[r]}function a(e,t,r){if(1!==t.size().length)throw new u(t.size(),1);var n=t.dimension(0);if("string"!=typeof n)throw new TypeError("String expected as index to retrieve an object property");var i=o(e);return i[n]=r,i}var o=r(3).clone,s=r(40).validateIndex,u=r(42);t.name="subset",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(this.items=e||[],!Array.isArray(this.items)||!this.items.every(function(e){return e&&e.isNode}))throw new TypeError("Array containing Nodes expected");var t=function(){throw new Error("Property `ArrayNode.nodes` is deprecated, use `ArrayNode.items` instead")};Object.defineProperty(this,"nodes",{get:t,set:t})}var o=n(r(272));return a.prototype=new o,a.prototype.type="ArrayNode",a.prototype.isArrayNode=!0,a.prototype._compile=function(e,t){var r="Array"!==e.math.config().matrix,n=this.items.map(function(r){return r._compile(e,t)});return(r?"math.matrix([":"[")+n.join(",")+(r?"])":"]")},a.prototype.forEach=function(e){for(var t=0;t<this.items.length;t++){var r=this.items[t];e(r,"items["+t+"]",this)}},a.prototype.map=function(e){for(var t=[],r=0;r<this.items.length;r++)t[r]=this._ifNode(e(this.items[r],"items["+r+"]",this));return new a(t)},a.prototype.clone=function(){return new a(this.items.slice(0))},a.prototype._toString=function(e){var t=this.items.map(function(t){return t.toString(e)});return"["+t.join(", ")+"]"},a.prototype._toTex=function(e){var t="\\begin{bmatrix}";return this.items.forEach(function(r){t+=r.items?r.items.map(function(t){return t.toTex(e)}).join("&"):r.toTex(e),t+="\\\\"}),t+="\\end{bmatrix}"},a}t.name="ArrayNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t,r){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(this.object=e,this.index=r?t:null,this.value=r?r:t,!e||!e.isSymbolNode&&!e.isAccessorNode)throw new TypeError('SymbolNode or AccessorNode expected as "object"');if(e&&e.isSymbolNode&&"end"===e.name)throw new Error('Cannot assign to symbol "end"');if(this.index&&!this.index.isIndexNode)throw new TypeError('IndexNode expected as "index"');if(!this.value||!this.value.isNode)throw new TypeError('Node expected as "value"');Object.defineProperty(this,"name",{get:function(){return this.index?this.index.isObjectProperty()?this.index.getObjectProperty():"":this.object.name||""}.bind(this),set:function(){throw new Error("Cannot assign a new name, name is read-only")}})}function o(e,t){t||(t="keep");var r=f.getPrecedence(e,t),n=f.getPrecedence(e.value,t);return"all"===t||null!==n&&r>=n}var s=n(r(272)),u=(n(r(277)),n(r(52)),n(r(279))),c=n(r(274)),f=(r(273),r(280));return a.prototype=new s,a.prototype.type="AssignmentNode",a.prototype.isAssignmentNode=!0,a.prototype._compile=function(e,t){e.assign=u,e.access=c;var r,n=this.object._compile(e,t),i=this.index?this.index._compile(e,t):null,a=this.value._compile(e,t);if(this.index){if(this.index.isObjectProperty())return n+'["'+this.index.getObjectProperty()+'"] = '+a;if(this.object.isSymbolNode)return r=this.index.needsSize()?"var size = math.size(object).valueOf();":"","(function () {  var object = "+n+";  var value = "+a+";  "+r+'  scope["'+this.object.name+'"] = assign(object, '+i+", value);  return value;})()";r=this.index.needsSize()?"var size = math.size(object).valueOf();":"";var o=this.object.object._compile(e,t);if(this.object.index.isObjectProperty()){var s='["'+this.object.index.getObjectProperty()+'"]';return"(function () {  var parent = "+o+";  var object = parent"+s+";  var value = "+a+";"+r+"  parent"+s+" = assign(object, "+i+", value);  return value;})()"}var f=this.object.index.needsSize()?"var size = math.size(parent).valueOf();":"",l=this.object.index._compile(e,t);return"(function () {  var parent = "+o+";  "+f+"  var parentIndex = "+l+";  var object = access(parent, parentIndex);  var value = "+a+";  "+r+"  assign(parent, parentIndex, assign(object, "+i+", value));  return value;})()"}if(!this.object.isSymbolNode)throw new TypeError("SymbolNode expected as object");return'scope["'+this.object.name+'"] = '+a},a.prototype.forEach=function(e){e(this.object,"object",this),this.index&&e(this.index,"index",this),e(this.value,"value",this)},a.prototype.map=function(e){var t=this._ifNode(e(this.object,"object",this)),r=this.index?this._ifNode(e(this.index,"index",this)):null,n=this._ifNode(e(this.value,"value",this));return new a(t,r,n)},a.prototype.clone=function(){return new a(this.object,this.index,this.value)},a.prototype._toString=function(e){var t=this.object.toString(e),r=this.index?this.index.toString(e):"",n=this.value.toString(e);return o(this,e&&e.parenthesis)&&(n="("+n+")"),t+r+" = "+n},a.prototype._toTex=function(e){var t=this.object.toTex(e),r=this.index?this.index.toTex(e):"",n=this.value.toTex(e);return o(this,e&&e.parenthesis)&&(n="\\left("+n+"\\right)"),t+r+":="+n},a}r(32);t.name="AssignmentNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(276)),s=n(r(52));return function(e,t,r){try{if(Array.isArray(e))return s(e).subset(t,r).valueOf();if(e&&"function"==typeof e.subset)return e.subset(t,r);if("string"==typeof e)return o(e,t,r);if("object"==typeof e){if(!t.isObjectProperty())throw TypeError("Cannot apply a numeric index as object property");return e[t.getObjectProperty()]=r,e}throw new TypeError("Cannot apply index: unsupported type of object")}catch(n){throw i(n)}}}var i=r(275).transform;t.factory=n},function(e,t){"use strict";function r(e,t){var r=e;"keep"!==t&&(r=e.getContent());for(var n=r.getIdentifier(),i=0;i<a.length;i++)if(n in a[i])return i;return null}function n(e,t){var n=e;"keep"!==t&&(n=e.getContent());var i=n.getIdentifier(),o=r(n,t);if(null===o)return null;var s=a[o][i];if(s.hasOwnProperty("associativity")){if("left"===s.associativity)return"left";if("right"===s.associativity)return"right";throw Error("'"+i+"' has the invalid associativity '"+s.associativity+"'.")}return null}function i(e,t,n){var i=e,o=t;if("keep"!==n)var i=e.getContent(),o=t.getContent();var s=i.getIdentifier(),u=o.getIdentifier(),c=r(i,n);if(null===c)return null;var f=a[c][s];if(f.hasOwnProperty("associativeWith")&&f.associativeWith instanceof Array){for(var l=0;l<f.associativeWith.length;l++)if(f.associativeWith[l]===u)return!0;return!1}return null}var a=[{AssignmentNode:{},FunctionAssignmentNode:{}},{ConditionalNode:{latexLeftParens:!1,latexRightParens:!1,latexParens:!1}},{"OperatorNode:or":{associativity:"left",associativeWith:[]}},{"OperatorNode:xor":{associativity:"left",associativeWith:[]}},{"OperatorNode:and":{associativity:"left",associativeWith:[]}},{"OperatorNode:bitOr":{associativity:"left",associativeWith:[]}},{"OperatorNode:bitXor":{associativity:"left",associativeWith:[]}},{"OperatorNode:bitAnd":{associativity:"left",associativeWith:[]}},{"OperatorNode:equal":{associativity:"left",associativeWith:[]},"OperatorNode:unequal":{associativity:"left",associativeWith:[]},"OperatorNode:smaller":{associativity:"left",associativeWith:[]},"OperatorNode:larger":{associativity:"left",associativeWith:[]},"OperatorNode:smallerEq":{associativity:"left",associativeWith:[]},"OperatorNode:largerEq":{associativity:"left",associativeWith:[]}},{"OperatorNode:leftShift":{associativity:"left",associativeWith:[]},"OperatorNode:rightArithShift":{associativity:"left",associativeWith:[]},"OperatorNode:rightLogShift":{associativity:"left",associativeWith:[]}},{"OperatorNode:to":{associativity:"left",associativeWith:[]}},{RangeNode:{}},{"OperatorNode:add":{associativity:"left",associativeWith:["OperatorNode:add","OperatorNode:subtract"]},"OperatorNode:subtract":{associativity:"left",associativeWith:[]}},{"OperatorNode:multiply":{associativity:"left",associativeWith:["OperatorNode:multiply","OperatorNode:divide","Operator:dotMultiply","Operator:dotDivide"]},"OperatorNode:divide":{associativity:"left",associativeWith:[],latexLeftParens:!1,latexRightParens:!1,latexParens:!1},"OperatorNode:dotMultiply":{associativity:"left",associativeWith:["OperatorNode:multiply","OperatorNode:divide","OperatorNode:dotMultiply","OperatorNode:doDivide"]},"OperatorNode:dotDivide":{associativity:"left",associativeWith:[]},"OperatorNode:mod":{associativity:"left",associativeWith:[]}},{"OperatorNode:unaryPlus":{associativity:"right"},"OperatorNode:unaryMinus":{associativity:"right"},"OperatorNode:bitNot":{associativity:"right"},"OperatorNode:not":{associativity:"right"}},{"OperatorNode:pow":{associativity:"right",associativeWith:[],latexRightParens:!1},"OperatorNode:dotPow":{associativity:"right",associativeWith:[]}},{"OperatorNode:factorial":{associativity:"left"}},{"OperatorNode:transpose":{associativity:"left"}}];e.exports.properties=a,e.exports.getPrecedence=r,e.exports.getAssociativity=n,e.exports.isAssociativeWith=i},function(e,t,r){"use strict";function n(e,t,n,i){function a(e){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");
if(!Array.isArray(e))throw new Error("Array expected");this.blocks=e.map(function(e){var t=e&&e.node,r=e&&void 0!==e.visible?e.visible:!0;if(!t||!t.isNode)throw new TypeError('Property "node" must be a Node');if("boolean"!=typeof r)throw new TypeError('Property "visible" must be a boolean');return{node:t,visible:r}})}var o=n(r(272)),s=n(r(72));return a.prototype=new o,a.prototype.type="BlockNode",a.prototype.isBlockNode=!0,a.prototype._compile=function(e,t){e.ResultSet=s;var r=this.blocks.map(function(r){var n=r.node._compile(e,t);return r.visible?"results.push("+n+");":n+";"});return"(function () {var results = [];"+r.join("")+"return new ResultSet(results);})()"},a.prototype.forEach=function(e){for(var t=0;t<this.blocks.length;t++)e(this.blocks[t].node,"blocks["+t+"].node",this)},a.prototype.map=function(e){for(var t=[],r=0;r<this.blocks.length;r++){var n=this.blocks[r],i=this._ifNode(e(n.node,"blocks["+r+"].node",this));t[r]={node:i,visible:n.visible}}return new a(t)},a.prototype.clone=function(){var e=this.blocks.map(function(e){return{node:e.node,visible:e.visible}});return new a(e)},a.prototype._toString=function(e){return this.blocks.map(function(t){return t.node.toString(e)+(t.visible?"":";")}).join("\n")},a.prototype._toTex=function(e){return this.blocks.map(function(t){return t.node.toTex(e)+(t.visible?"":";")}).join("\\;\\;\n")},a}t.name="BlockNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,t,r){if(!(this instanceof o))throw new SyntaxError("Constructor must be called with the new operator");if(!e||!e.isNode)throw new TypeError("Parameter condition must be a Node");if(!t||!t.isNode)throw new TypeError("Parameter trueExpr must be a Node");if(!r||!r.isNode)throw new TypeError("Parameter falseExpr must be a Node");this.condition=e,this.trueExpr=t,this.falseExpr=r}var s=n(r(272));return o.prototype=new s,o.prototype.type="ConditionalNode",o.prototype.isConditionalNode=!0,o.prototype._compile=function(e,t){return e.testCondition=function(t){if("number"==typeof t||"boolean"==typeof t||"string"==typeof t)return!!t;if(t){if(t.isBigNumber===!0)return!t.isZero();if(t.isComplex===!0)return!(!t.re&&!t.im);if(t.isUnit===!0)return!!t.value}if(null===t||void 0===t)return!1;throw new TypeError('Unsupported type of condition "'+e.math["typeof"](t)+'"')},"testCondition("+this.condition._compile(e,t)+") ? ( "+this.trueExpr._compile(e,t)+") : ( "+this.falseExpr._compile(e,t)+")"},o.prototype.forEach=function(e){e(this.condition,"condition",this),e(this.trueExpr,"trueExpr",this),e(this.falseExpr,"falseExpr",this)},o.prototype.map=function(e){return new o(this._ifNode(e(this.condition,"condition",this)),this._ifNode(e(this.trueExpr,"trueExpr",this)),this._ifNode(e(this.falseExpr,"falseExpr",this)))},o.prototype.clone=function(){return new o(this.condition,this.trueExpr,this.falseExpr)},o.prototype._toString=function(e){var t=e&&e.parenthesis?e.parenthesis:"keep",r=i.getPrecedence(this,t),n=this.condition.toString(e),a=i.getPrecedence(this.condition,t);("all"===t||"OperatorNode"===this.condition.type||null!==a&&r>=a)&&(n="("+n+")");var o=this.trueExpr.toString(e),s=i.getPrecedence(this.trueExpr,t);("all"===t||"OperatorNode"===this.trueExpr.type||null!==s&&r>=s)&&(o="("+o+")");var u=this.falseExpr.toString(e),c=i.getPrecedence(this.falseExpr,t);return("all"===t||"OperatorNode"===this.falseExpr.type||null!==c&&r>=c)&&(u="("+u+")"),n+" ? "+o+" : "+u},o.prototype._toTex=function(e){return"\\begin{cases} {"+this.trueExpr.toTex(e)+"}, &\\quad{\\text{if }\\;"+this.condition.toTex(e)+"}\\\\{"+this.falseExpr.toTex(e)+"}, &\\quad{\\text{otherwise}}\\end{cases}"},o}var i=(r(32),r(280));t.name="ConditionalNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,t){if(!(this instanceof o))throw new SyntaxError("Constructor must be called with the new operator");if(t){if("string"!=typeof t)throw new TypeError('String expected for parameter "valueType"');if("string"!=typeof e)throw new TypeError('String expected for parameter "value"');this.value=e,this.valueType=t}else this.value=e+"",this.valueType=i(e);if(!u[this.valueType])throw new TypeError('Unsupported type of value "'+this.valueType+'"')}var s=n(r(272)),u={number:!0,string:!0,"boolean":!0,undefined:!0,"null":!0};return o.prototype=new s,o.prototype.type="ConstantNode",o.prototype.isConstantNode=!0,o.prototype._compile=function(e,t){switch(this.valueType){case"number":var r=e.math.config().number;return"BigNumber"===r?'math.bignumber("'+this.value+'")':"Fraction"===r?'math.fraction("'+this.value+'")':this.value.replace(/^(0*)[0-9]/,function(e,t){return e.substring(t.length)});case"string":return'"'+this.value+'"';case"boolean":return this.value;case"undefined":return this.value;case"null":return this.value;default:throw new TypeError('Unsupported type of constant "'+this.valueType+'"')}},o.prototype.forEach=function(e){},o.prototype.map=function(e){return this.clone()},o.prototype.clone=function(){return new o(this.value,this.valueType)},o.prototype._toString=function(e){switch(this.valueType){case"string":return'"'+this.value+'"';default:return this.value}},o.prototype._toTex=function(e){var t,r=this.value;switch(this.valueType){case"string":return'\\mathtt{"'+r+'"}';case"number":return t=r.toLowerCase().indexOf("e"),-1!==t?r.substring(0,t)+"\\cdot10^{"+r.substring(t+1)+"}":r;default:return r}},o}var i=r(41).type;t.name="ConstantNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e){return"string"==typeof e}function i(e,t,i,u){function c(e,t,r){if(!(this instanceof c))throw new SyntaxError("Constructor must be called with the new operator");if("string"!=typeof e)throw new TypeError('String expected for parameter "name"');if(!Array.isArray(t)||!t.every(n))throw new TypeError('Array containing strings expected for parameter "params"');if(!r||!r.isNode)throw new TypeError('Node expected for parameter "expr"');if(e in a)throw new Error('Illegal function name, "'+e+'" is a reserved keyword');this.name=e,this.params=t,this.expr=r}function f(e,t){var r=s.getPrecedence(e,t),n=s.getPrecedence(e.expr,t);return"all"===t||null!==n&&r>=n}var l=i(r(272));return c.prototype=new l,c.prototype.type="FunctionAssignmentNode",c.prototype.isFunctionAssignmentNode=!0,c.prototype._compile=function(e,t){var r=Object.create(t);this.params.forEach(function(e){r[e]=!0});var n=this.expr._compile(e,r);return'scope["'+this.name+'"] =   (function () {    var fn = function '+this.name+"("+this.params.join(",")+") {      if (arguments.length != "+this.params.length+') {        throw new SyntaxError("Wrong number of arguments in function '+this.name+' (" + arguments.length + " provided, '+this.params.length+' expected)");      }      return '+n+'    };    fn.syntax = "'+this.name+"("+this.params.join(", ")+')";    return fn;  })()'},c.prototype.forEach=function(e){e(this.expr,"expr",this)},c.prototype.map=function(e){var t=this._ifNode(e(this.expr,"expr",this));return new c(this.name,this.params.slice(0),t)},c.prototype.clone=function(){return new c(this.name,this.params.slice(0),this.expr)},c.prototype._toString=function(e){var t=e&&e.parenthesis?e.parenthesis:"keep",r=this.expr.toString(e);return f(this,t)&&(r="("+r+")"),"function "+this.name+"("+this.params.join(", ")+") = "+r},c.prototype._toTex=function(e){var t=e&&e.parenthesis?e.parenthesis:"keep",r=this.expr.toTex(e);return f(this,t)&&(r="\\left("+r+"\\right)"),"\\mathrm{"+this.name+"}\\left("+this.params.map(o.toSymbol).join(",")+"\\right):="+r},c}var a=r(273),o=r(32),s=r(280);t.name="FunctionAssignmentNode",t.path="expression.node",t.factory=i},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(this.dimensions=e,this.dotNotation=t||!1,!u(e)||!e.every(function(e){return e&&e.isNode}))throw new TypeError('Array containing Nodes expected for parameter "dimensions"');if(this.dotNotation&&!this.isObjectProperty())throw new Error("dotNotation only applicable for object properties");var r=function(){throw new Error("Property `IndexNode.object` is deprecated, use `IndexNode.fn` instead")};Object.defineProperty(this,"object",{get:r,set:r})}var o=n(r(272)),s=(n(r(286)),n(r(287)),n(r(67))),u=Array.isArray;return a.prototype=new o,a.prototype.type="IndexNode",a.prototype.isIndexNode=!0,a.prototype._compile=function(e,t){var r=Object.create(t);e.range=function(e,t,r){return new s(e&&e.isBigNumber===!0?e.toNumber():e,t&&t.isBigNumber===!0?t.toNumber():t,r&&r.isBigNumber===!0?r.toNumber():r)};var n=this.dimensions.map(function(t,n){return t&&t.isRangeNode?t.needsEnd()?(r.end=!0,"(function () {var end = size["+n+"]; return range("+t.start._compile(e,r)+", "+t.end._compile(e,r)+", "+(t.step?t.step._compile(e,r):"1")+"); })()"):"range("+t.start._compile(e,r)+", "+t.end._compile(e,r)+", "+(t.step?t.step._compile(e,r):"1")+")":t.isSymbolNode&&"end"===t.name?(r.end=!0,"(function () {var end = size["+n+"]; return "+t._compile(e,r)+"; })()"):t._compile(e,r)});return"math.index("+n.join(", ")+")"},a.prototype.forEach=function(e){for(var t=0;t<this.dimensions.length;t++)e(this.dimensions[t],"dimensions["+t+"]",this)},a.prototype.map=function(e){for(var t=[],r=0;r<this.dimensions.length;r++)t[r]=this._ifNode(e(this.dimensions[r],"dimensions["+r+"]",this));return new a(t)},a.prototype.clone=function(){return new a(this.dimensions.slice(0))},a.prototype.isObjectProperty=function(){return 1===this.dimensions.length&&this.dimensions[0].isConstantNode&&"string"===this.dimensions[0].valueType},a.prototype.getObjectProperty=function(){return this.isObjectProperty()?this.dimensions[0].value:null},a.prototype._toString=function(e){return this.dotNotation?"."+this.getObjectProperty():"["+this.dimensions.join(", ")+"]"},a.prototype._toTex=function(e){var t=this.dimensions.map(function(t){return t.toTex(e)});return this.dotNotation?"."+this.getObjectProperty():"_{"+t.join(",")+"}"},a.prototype.needsSize=function(){return this.dimensions.some(function(e){return e.isRangeNode&&e.needsEnd()||e.isSymbolNode&&"end"===e.name})},a}t.name="IndexNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,t,r){if(!(this instanceof o))throw new SyntaxError("Constructor must be called with the new operator");if(!e||!e.isNode)throw new TypeError("Node expected");if(!t||!t.isNode)throw new TypeError("Node expected");if(r&&(!r||!r.isNode))throw new TypeError("Node expected");if(arguments.length>3)throw new Error("Too many arguments");this.start=e,this.end=t,this.step=r||null}function s(e,t){var r=i.getPrecedence(e,t),n={},a=i.getPrecedence(e.start,t);if(n.start=null!==a&&r>=a||"all"===t,e.step){var o=i.getPrecedence(e.step,t);n.step=null!==o&&r>=o||"all"===t}var s=i.getPrecedence(e.end,t);return n.end=null!==s&&r>=s||"all"===t,n}var u=n(r(272));return o.prototype=new u,o.prototype.type="RangeNode",o.prototype.isRangeNode=!0,o.prototype.needsEnd=function(){var e=this.filter(function(e){return e&&e.isSymbolNode&&"end"==e.name});return e.length>0},o.prototype._compile=function(e,t){return"math.range("+this.start._compile(e,t)+", "+this.end._compile(e,t)+(this.step?", "+this.step._compile(e,t):"")+")"},o.prototype.forEach=function(e){e(this.start,"start",this),e(this.end,"end",this),this.step&&e(this.step,"step",this)},o.prototype.map=function(e){return new o(this._ifNode(e(this.start,"start",this)),this._ifNode(e(this.end,"end",this)),this.step&&this._ifNode(e(this.step,"step",this)))},o.prototype.clone=function(){return new o(this.start,this.end,this.step&&this.step)},o.prototype._toString=function(e){var t,r=e&&e.parenthesis?e.parenthesis:"keep",n=s(this,r),i=this.start.toString(e);if(n.start&&(i="("+i+")"),t=i,this.step){var a=this.step.toString(e);n.step&&(a="("+a+")"),t+=":"+a}var o=this.end.toString(e);return n.end&&(o="("+o+")"),t+=":"+o},o.prototype._toTex=function(e){var t=e&&e.parenthesis?e.parenthesis:"keep",r=s(this,t),n=this.start.toTex(e);if(r.start&&(n="\\left("+n+"\\right)"),this.step){var i=this.step.toTex(e);r.step&&(i="\\left("+i+"\\right)"),n+=":"+i}var a=this.end.toTex(e);return r.end&&(a="\\left("+a+"\\right)"),n+=":"+a},o}var i=r(280);t.name="RangeNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a,o){function s(e){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");if("string"!=typeof e)throw new TypeError('String expected for parameter "name"');this.name=e}function u(e){throw new Error("Undefined symbol "+e)}var c=n(r(272)),f=n(r(75));return s.prototype=new c,s.prototype.type="SymbolNode",s.prototype.isSymbolNode=!0,s.prototype._compile=function(e,t){return e.undef=u,e.Unit=f,t[this.name]?this.name:this.name in e.math?'("'+this.name+'" in scope ? scope["'+this.name+'"] : math["'+this.name+'"])':'("'+this.name+'" in scope ? scope["'+this.name+'"] : '+(f.isValuelessUnit(this.name)?'new Unit(null, "'+this.name+'")':'undef("'+this.name+'")')+")"},s.prototype.forEach=function(e){},s.prototype.map=function(e){return this.clone()},s.prototype.clone=function(){return new s(this.name)},s.prototype._toString=function(e){return this.name},s.prototype._toTex=function(e){var t=!1;"undefined"==typeof o[this.name]&&f.isValuelessUnit(this.name)&&(t=!0);var r=i.toSymbol(this.name,t);return"\\"===r[0]?r:" "+r},s}var i=r(32);t.name="SymbolNode",t.path="expression.node",t.math=!0,t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(this.properties=e||{},e&&("object"!=typeof e||Object.keys(e).some(function(t){return!e[t]||!e[t].isNode})))throw new TypeError("Object containing Nodes expected")}var o=n(r(272));return a.prototype=new o,a.prototype.type="ObjectNode",a.prototype.isObjectNode=!0,a.prototype._compile=function(e,t){var r=[];for(var n in this.properties)this.properties.hasOwnProperty(n)&&r.push('"'+n+'": '+this.properties[n]._compile(e,t));return"{"+r.join(", ")+"}"},a.prototype.forEach=function(e){for(var t in this.properties)this.properties.hasOwnProperty(t)&&e(this.properties[t],'properties["'+t+'"]',this)},a.prototype.map=function(e){var t={};for(var r in this.properties)this.properties.hasOwnProperty(r)&&(t[r]=this._ifNode(e(this.properties[r],'properties["'+r+'"]',this)));return new a(t)},a.prototype.clone=function(){var e={};for(var t in this.properties)this.properties.hasOwnProperty(t)&&(e[t]=this.properties[t]);return new a(e)},a.prototype._toString=function(e){var t=[];for(var r in this.properties)this.properties.hasOwnProperty(r)&&t.push('"'+r+'": '+this.properties[r].toString(e));return"{"+t.join(", ")+"}"},a.prototype._toTex=function(e){var t=[];for(var r in this.properties)this.properties.hasOwnProperty(r)&&t.push("\\mathbf{"+r+":} & "+this.properties[r].toTex(e)+"\\\\");return"\\left\\{\\begin{array}{ll}"+t.join("\n")+"\\end{array}\\right\\}"},a}r(23);t.name="ObjectNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o,s){function u(e,t,r,n){if(!(this instanceof u))throw new SyntaxError("Constructor must be called with the new operator");if("string"!=typeof e)throw new TypeError('string expected for parameter "op"');if("string"!=typeof t)throw new TypeError('string expected for parameter "fn"');if(!Array.isArray(r)||!r.every(function(e){return e&&e.isNode}))throw new TypeError('Array containing Nodes expected for parameter "args"');this.implicit=n===!0,this.op=e,this.fn=t,this.args=r||[]}function c(e,t,r,n){var i=a.getPrecedence(e,t),o=a.getAssociativity(e,t);if("all"===t||r.length>2){var s=[];return r.forEach(function(e){switch(e.getContent().type){case"ArrayNode":case"ConstantNode":case"SymbolNode":case"ParenthesisNode":s.push(!1);break;default:s.push(!0)}}),s}switch(r.length){case 0:return[];case 1:var u=a.getPrecedence(r[0],t);if(n&&null!==u){var c,f;if("keep"===t?(c=r[0].getIdentifier(),f=e.getIdentifier()):(c=r[0].getContent().getIdentifier(),f=e.getContent().getIdentifier()),a.properties[i][f].latexLeftParens===!1)return[!1];if(a.properties[u][c].latexParens===!1)return[!1]}return null===u?[!1]:i>=u?[!0]:[!1];case 2:var l,p=a.getPrecedence(r[0],t),h=a.isAssociativeWith(e,r[0],t);l=null===p?!1:p!==i||"right"!==o||h?i>p:!0;var m,d=a.getPrecedence(r[1],t),g=a.isAssociativeWith(e,r[1],t);if(m=null===d?!1:d!==i||"left"!==o||g?i>d:!0,n){var f,v,y;"keep"===t?(f=e.getIdentifier(),v=e.args[0].getIdentifier(),y=e.args[1].getIdentifier()):(f=e.getContent().getIdentifier(),v=e.args[0].getContent().getIdentifier(),y=e.args[1].getContent().getIdentifier()),null!==p&&(a.properties[i][f].latexLeftParens===!1&&(l=!1),a.properties[p][v].latexParens===!1&&(l=!1)),null!==d&&(a.properties[i][f].latexRightParens===!1&&(m=!1),a.properties[d][y].latexParens===!1&&(m=!1))}return[l,m]}}var f=n(r(272));n(r(283)),n(r(287)),n(r(290));return u.prototype=new f,u.prototype.type="OperatorNode",u.prototype.isOperatorNode=!0,u.prototype._compile=function(e,t){if(!e.math[this.fn])throw new Error("Function "+this.fn+' missing in provided namespace "math"');var r=this.args.map(function(r){return r._compile(e,t)});return"math."+this.fn+"("+r.join(", ")+")"},u.prototype.forEach=function(e){for(var t=0;t<this.args.length;t++)e(this.args[t],"args["+t+"]",this)},u.prototype.map=function(e){for(var t=[],r=0;r<this.args.length;r++)t[r]=this._ifNode(e(this.args[r],"args["+r+"]",this));return new u(this.op,this.fn,t)},u.prototype.clone=function(){return new u(this.op,this.fn,this.args.slice(0))},u.prototype._toString=function(e){var t=e&&e.parenthesis?e.parenthesis:"keep",r=e&&e.implicit?e.implicit:"hide",n=this.args,i=c(this,t,n,!1);switch(n.length){case 1:var o=a.getAssociativity(this,t),s=n[0].toString(e);return i[0]&&(s="("+s+")"),"right"===o?this.op+s:"left"===o?s+this.op:s+this.op;case 2:var u=n[0].toString(e),f=n[1].toString(e);return i[0]&&(u="("+u+")"),i[1]&&(f="("+f+")"),this.implicit&&"OperatorNode:multiply"===this.getIdentifier()&&"hide"==r?u+" "+f:u+" "+this.op+" "+f;default:return this.fn+"("+this.args.join(", ")+")"}},u.prototype._toTex=function(e){var t=e&&e.parenthesis?e.parenthesis:"keep",r=e&&e.implicit?e.implicit:"hide",n=this.args,o=c(this,t,n,!0),s=i.operators[this.fn];switch(s="undefined"==typeof s?this.op:s,n.length){case 1:var u=a.getAssociativity(this,t),f=n[0].toTex(e);return o[0]&&(f="\\left("+f+"\\right)"),"right"===u?s+f:"left"===u?f+s:f+s;case 2:var l=n[0],p=l.toTex(e);o[0]&&(p="\\left("+p+"\\right)");var h=n[1],m=h.toTex(e);o[1]&&(m="\\left("+m+"\\right)");var d;switch(d="keep"===t?l.getIdentifier():l.getContent().getIdentifier(),this.getIdentifier()){case"OperatorNode:divide":return s+"{"+p+"}{"+m+"}";case"OperatorNode:pow":switch(p="{"+p+"}",m="{"+m+"}",d){case"ConditionalNode":case"OperatorNode:divide":p="\\left("+p+"\\right)"}case"OperatorNode:multiply":if(this.implicit&&"hide"===r)return p+"~"+m}return p+s+m;default:return"\\mathrm{"+this.fn+"}\\left("+n.map(function(t){return t.toTex(e)}).join(",")+"\\right)"}},u.prototype.getIdentifier=function(){return this.type+":"+this.fn},u}var i=r(32),a=r(280);t.name="OperatorNode",t.path="expression.node",t.math=!0,t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a,o){function s(e,t){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");if("string"==typeof e&&(console.warn("WARNING: passing a string to FunctionNode is deprecated, pass a SymbolNode instead."),e=new f(e)),!e||!e.isNode)throw new TypeError('Node expected as parameter "fn"');if(!Array.isArray(t)||!t.every(function(e){return e&&e.isNode}))throw new TypeError('Array containing Nodes expected for parameter "args"');this.fn=e,this.args=t||[],Object.defineProperty(this,"name",{get:function(){return this.fn.name||""}.bind(this),set:function(){throw new Error("Cannot assign a new name, name is read-only")}});var r=function(){throw new Error("Property `FunctionNode.object` is deprecated, use `FunctionNode.fn` instead")};Object.defineProperty(this,"object",{get:r,set:r})}function u(e,t,r){for(var n,i="",a=new RegExp("\\$(?:\\{([a-z_][a-z_0-9]*)(?:\\[([0-9]+)\\])?\\}|\\$)","ig"),o=0;null!==(n=a.exec(e));)if(i+=e.substring(o,n.index),o=n.index,"$$"===n[0])i+="$",o++;else{o+=n[0].length;var s=t[n[1]];if(!s)throw new ReferenceError("Template: Property "+n[1]+" does not exist.");if(void 0===n[2])switch(typeof s){case"string":i+=s;break;case"object":if(s.isNode)i+=s.toTex(r);else{if(!Array.isArray(s))throw new TypeError("Template: "+n[1]+" has to be a Node, String or array of Nodes");i+=s.map(function(e,t){if(e&&e.isNode)return e.toTex(r);throw new TypeError("Template: "+n[1]+"["+t+"] is not a Node.")}).join(",")}break;default:throw new TypeError("Template: "+n[1]+" has to be a Node, String or array of Nodes")}else{if(!s[n[2]]||!s[n[2]].isNode)throw new TypeError("Template: "+n[1]+"["+n[2]+"] is not a Node.");i+=s[n[2]].toTex(r)}}return i+=e.slice(o)}var c=n(r(272)),f=n(r(287));s.prototype=new c,s.prototype.type="FunctionNode",s.prototype.isFunctionNode=!0,s.prototype._compile=function(e,t){var r,n=this.fn._compile(e,t),i=this.args.map(function(r){return r._compile(e,t)});if(this.fn.isSymbolNode){var a=this.fn.name,o=e.math[a],s="function"==typeof o&&1==o.rawArgs;return s?(r=this._getUniqueArgumentsName(e),e[r]=this.args,n+"("+r+", math, scope)"):n+"("+i.join(", ")+")"}if(this.fn.isAccessorNode&&this.fn.index.isObjectProperty()){r=this._getUniqueArgumentsName(e),e[r]=this.args;var u=this.fn.object._compile(e,t),c=this.fn.index.getObjectProperty();return"(function () {var object = "+u+';return (object["'+c+'"] && object["'+c+'"].rawArgs)  ? object["'+c+'"]('+r+', math, scope) : object["'+c+'"]('+i.join(", ")+")})()"}return r=this._getUniqueArgumentsName(e),e[r]=this.args,"(function () {var fn = "+n+";return (fn && fn.rawArgs)  ? fn("+r+", math, scope) : fn("+i.join(", ")+")})()"},s.prototype._getUniqueArgumentsName=function(e){var t,r=0;do t="args"+r,r++;while(t in e);return t},s.prototype.forEach=function(e){for(var t=0;t<this.args.length;t++)e(this.args[t],"args["+t+"]",this)},s.prototype.map=function(e){for(var t=this.fn.map(e),r=[],n=0;n<this.args.length;n++)r[n]=this._ifNode(e(this.args[n],"args["+n+"]",this));return new s(t,r)},s.prototype.clone=function(){return new s(this.fn,this.args.slice(0))};var l=s.prototype.toString;s.prototype.toString=function(e){var t,r=this.fn.toString(e);return e&&"object"==typeof e.handler&&e.handler.hasOwnProperty(r)&&(t=e.handler[r](this,e)),"undefined"!=typeof t?t:l.call(this,e)},s.prototype._toString=function(e){var t=this.args.map(function(t){return t.toString(e)});return this.fn.toString(e)+"("+t.join(", ")+")"};var p=s.prototype.toTex;return s.prototype.toTex=function(e){var t;return e&&"object"==typeof e.handler&&e.handler.hasOwnProperty(this.name)&&(t=e.handler[this.name](this,e)),"undefined"!=typeof t?t:p.call(this,e)},s.prototype._toTex=function(e){var t,r=this.args.map(function(t){return t.toTex(e)});!o[this.name]||"function"!=typeof o[this.name].toTex&&"object"!=typeof o[this.name].toTex&&"string"!=typeof o[this.name].toTex||(t=o[this.name].toTex);var n;switch(typeof t){case"function":n=t(this,e);break;case"string":n=u(t,this,e);break;case"object":switch(typeof t[r.length]){case"function":n=t[r.length](this,e);break;case"string":n=u(t[r.length],this,e)}}return"undefined"!=typeof n?n:u(i.defaultTemplate,this,e)},s.prototype.getIdentifier=function(){return this.type+":"+this.name},s}var i=r(32);t.name="FunctionNode",t.path="expression.node",t.math=!0,t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e){if(!(this instanceof a))throw new SyntaxError("Constructor must be called with the new operator");if(!e||!e.isNode)throw new TypeError('Node expected for parameter "content"');this.content=e}var o=n(r(272));return a.prototype=new o,a.prototype.type="ParenthesisNode",a.prototype.isParenthesisNode=!0,a.prototype._compile=function(e,t){return this.content._compile(e,t)},a.prototype.getContent=function(){return this.content.getContent()},a.prototype.forEach=function(e){e(this.content,"content",this)},a.prototype.map=function(e){var t=e(this.content,"content",this);return new a(t)},a.prototype.clone=function(){return new a(this.content)},a.prototype._toString=function(e){return!e||e&&!e.parenthesis||e&&"keep"===e.parenthesis?"("+this.content.toString(e)+")":this.content.toString(e)},a.prototype._toTex=function(e){return!e||e&&!e.parenthesis||e&&"keep"===e.parenthesis?"\\left("+this.content.toTex(e)+"\\right)":this.content.toTex(e)},a}t.name="ParenthesisNode",t.path="expression.node",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(270));return a("compile",{string:function(e){var t={};return o(e).compile().eval(t)},"string, Object":function(e,t){return o(e).compile().eval(t)},"Array | Matrix":function(e){var t={};return i(e,function(e){return o(e).compile().eval(t)})},"Array | Matrix, Object":function(e,t){return i(e,function(e){return o(e).compile().eval(t)})}})}var i=r(19);t.name="eval",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i,a){var o=n(r(96));return i("help",{any:function(t){var r,n=t;if("string"!=typeof t)for(r in a)if(a.hasOwnProperty(r)&&t===a[r]){n=r;break}var i=o[n];if(!i)throw new Error('No documentation found on "'+n+'"');return new e.Help(i)}})}t.math=!0,t.name="help",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(270));return i("parse",{"string | Array | Matrix":a,"string | Array | Matrix, Object":a})}t.name="parse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i,a){var o=n(r(296));return i("parser",{"":function(){return new o(a)}})}t.name="parser",t.factory=n,t.math=!0},function(e,t,r){"use strict";function n(e,t,n,a,o){function s(){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");this.scope={}}var u=n(r(270));return s.prototype.type="Parser",s.prototype.isParser=!0,s.prototype.parse=function(e){throw new Error("Parser.parse is deprecated. Use math.parse instead.")},s.prototype.compile=function(e){throw new Error("Parser.compile is deprecated. Use math.compile instead.")},s.prototype.eval=function(e){return u(e).compile().eval(this.scope)},s.prototype.get=function(e){return this.scope[e]},s.prototype.getAll=function(){return i({},this.scope)},s.prototype.set=function(e,t){return this.scope[e]=t},s.prototype.remove=function(e){delete this.scope[e]},s.prototype.clear=function(){for(var e in this.scope)this.scope.hasOwnProperty(e)&&delete this.scope[e]},s}var i=r(3).extend;t.name="Parser",t.path="expression",t.factory=n,t.math=!0},function(e,t,r){e.exports=[r(271),r(277),r(278),r(281),r(282),r(283),r(285),r(284),r(290),r(272),r(288),r(289),r(291),r(286),r(287),r(298)]},function(e,t){"use strict";function r(e,t,r,n){function i(){throw new Error("UpdateNode is deprecated. Use AssignmentNode instead.")}return i}t.name="UpdateNode",t.path="expression.node",t.factory=r},function(e,t,r){e.exports=[r(300),r(302),r(304),r(306),r(307),r(309),r(315),r(320),r(322),r(324)]},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(301));return a("concat",{"...any":function(e){var t=e.length-1,r=e[t];"number"==typeof r?e[t]=r-1:r&&r.isBigNumber===!0&&(e[t]=r.minus(1));try{return o.apply(null,e)}catch(n){throw i(n)}}})}var i=r(275).transform;t.name="concat",t.path="expression.transform",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,f){var l=n(r(52)),p=f("concat",{"...Array | Matrix | number | BigNumber":function(e){var t,r,n=e.length,f=-1,p=!1,h=[];for(t=0;n>t;t++){var m=e[t];if(m&&m.isMatrix===!0&&(p=!0),"number"==typeof m||m&&m.isBigNumber===!0){if(t!==n-1)throw new Error("Dimension must be specified as last argument");if(r=f,f=m.valueOf(),!o(f))throw new TypeError("Integer number expected for dimension");if(0>f||t>0&&f>r)throw new u(f,r+1)}else{var d=a(m).valueOf(),g=s.size(d);if(h[t]=d,r=f,f=g.length-1,t>0&&f!=r)throw new c(r+1,f+1)}}if(0==h.length)throw new SyntaxError("At least one matrix expected");for(var v=h.shift();h.length;)v=i(v,h.shift(),f,0);return p?l(v):v},"...string":function(e){return e.join("")}});return p.toTex=void 0,p}function i(e,t,r,n){if(r>n){if(e.length!=t.length)throw new c(e.length,t.length);for(var a=[],o=0;o<e.length;o++)a[o]=i(e[o],t[o],r,n+1);return a}return e.concat(t)}var a=r(3).clone,o=r(6).isInteger,s=r(40),u=r(43),c=r(42);t.name="concat",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t,r){var n,i;if(e[0]&&(n=e[0].compile().eval(r)),e[1])if(e[1]&&e[1].isSymbolNode)i=e[1].compile().eval(r);else{var a=r||{},s=e[1].filter(function(e){return e&&e.isSymbolNode&&!(e.name in t)&&!(e.name in a)})[0],u=Object.create(a),c=e[1].compile();if(!s)throw new Error("No undefined variable found in filter equation");var f=s.name;i=function(e){return u[f]=e,c.eval(u)}}return o(n,i)}var o=n(r(303));n(r(287));return a.rawArgs=!0,a}t.name="filter",t.path="expression.transform",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=o("filter",{"Array, function":i,"Array, RegExp":a,"Matrix, function":function(e,t){return s(i(e.toArray(),t))},"Matrix, RegExp":function(e,t){return s(a(e.toArray(),t))}});return u.toTex=void 0,u}function i(e,t){if(1!==o(e).length)throw new Error("Only one dimensional matrices supported");return e.filter(function(e){return t(e)})}function a(e,t){if(1!==o(e).length)throw new Error("Only one dimensional matrices supported");return e.filter(function(e){return t.test(e)})}var o=r(40).size;t.name="filter",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){n(r(305));return i("forEach",{"Array | Matrix, function":function(e,t){var r=function(n,i){Array.isArray(n)?n.forEach(function(e,t){r(e,i.concat(t+1))}):t(n,i,e)};r(e.valueOf(),[])}})}t.name="forEach",t.path="expression.transform",t.factory=n},function(e,t){"use strict";function r(e,t,r,i){var a=i("forEach",{"Array, function":n,"Matrix, function":function(e,t){return e.forEach(t)}});return a.toTex=void 0,a}function n(e,t){var r=function(n,i){Array.isArray(n)?n.forEach(function(e,t){r(e,i.concat(t))}):t(n,i,e)};r(e,[])}t.name="forEach",t.factory=r},function(e,t,r){"use strict";function n(e,t,n){n(r(68));return function(){for(var t=[],r=0,n=arguments.length;n>r;r++){var i=arguments[r];if(i&&i.isRange===!0)i.start--,i.end-=i.step>0?0:2;else if(i&&i.isSet===!0)i=i.map(function(e){return e-1});else if(i&&(i.isArray===!0||i.isMatrix))i=i.map(function(e){return e-1});else if("number"==typeof i)i--;else if(i&&i.isBigNumber===!0)i=i.toNumber()-1;else if("string"!=typeof i)throw new TypeError("Dimension must be an Array, Matrix, number, string, or Range");t[r]=i}var a=new e.Index;return e.Index.apply(a,t),a}}Array.isArray;t.name="index",t.path="expression.transform",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=(n(r(308)),n(r(52)));return a("max",{"Array, function":function(e,t){return i(e,t,e)},"Matrix, function":function(e,t){return o(i(e.valueOf(),t,e))}})}function i(e,t,r){function n(e,i){return Array.isArray(e)?e.map(function(e,t){return n(e,i.concat(t+1))}):t(e,i,r)}return n(e,[])}t.name="map",t.path="expression.transform",t.factory=n},function(e,t){"use strict";function r(e,t,r,i){var a=i("map",{"Array, function":n,"Matrix, function":function(e,t){return e.map(t)}});return a.toTex=void 0,a}function n(e,t){var r=function(n,i){return Array.isArray(n)?n.map(function(e,t){return r(e,i.concat(t))}):t(n,i,e)};return r(e,[])}t.name="map",t.factory=r},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(311));return o("max",{"...any":function(e){if(2==e.length&&a(e[0])){var t=e[1];"number"==typeof t?e[1]=t-1:t&&t.isBigNumber===!0&&(e[1]=t.minus(1))}try{return s.apply(null,e)}catch(r){throw i(r)}}})}var i=r(275).transform,a=r(310);t.name="max",t.path="expression.transform",t.factory=n},function(e,t){"use strict";
e.exports=function(e){return Array.isArray(e)||e&&e.isMatrix===!0}},function(e,t,r){"use strict";function n(e,t,n,s){function u(e,t){return f(e,t)?e:t}function c(e){var t=void 0;if(i(e,function(e){(void 0===t||f(e,t))&&(t=e)}),void 0===t)throw new Error("Cannot calculate max of an empty array");return t}var f=n(r(64)),l=s("max",{"Array | Matrix":c,"Array | Matrix, number | BigNumber":function(e,t){return a(e,t.valueOf(),u)},"...":function(e){if(o(e))throw new TypeError("Scalar values expected in function max");return c(e)}});return l.toTex="\\max\\left(${args}\\right)",l}var i=r(312),a=r(313),o=r(314);t.name="max",t.factory=n},function(e,t){"use strict";e.exports=function r(e,t){e&&e.isMatrix===!0&&(e=e.valueOf());for(var n=0,i=e.length;i>n;n++){var a=e[n];Array.isArray(a)?r(a,t):t(a)}}},function(e,t,r){"use strict";function n(e,t,r){var a,o,s,u;if(0>=t){if(Array.isArray(e[0])){for(u=i(e),o=[],a=0;a<u.length;a++)o[a]=n(u[a],t-1,r);return o}for(s=e[0],a=1;a<e.length;a++)s=r(s,e[a]);return s}for(o=[],a=0;a<e.length;a++)o[a]=n(e[a],t-1,r);return o}function i(e){var t,r,n=e.length,i=e[0].length,a=[];for(r=0;i>r;r++){var o=[];for(t=0;n>t;t++)o.push(e[t][r]);a.push(o)}return a}var a=r(40).size,o=r(43);e.exports=function(e,t,r){var i=Array.isArray(e)?a(e):e.size();if(0>t||t>=i.length)throw new o(t,i.length);return e&&e.isMatrix===!0?e.create(n(e.valueOf(),t,r)):n(e,t,r)}},function(e,t,r){"use strict";var n=r(310);e.exports=function(e){for(var t=0;t<e.length;t++)if(n(e[t]))return!0;return!1}},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(316));return o("mean",{"...any":function(e){if(2==e.length&&a(e[0])){var t=e[1];"number"==typeof t?e[1]=t-1:t&&t.isBigNumber===!0&&(e[1]=t.minus(1))}try{return s.apply(null,e)}catch(r){throw i(r)}}})}var i=r(275).transform,a=r(310);t.name="mean",t.path="expression.transform",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,u){function c(e,t){var r=o(e,t,l),n=Array.isArray(e)?i(e):e.size();return p(r,n[t])}function f(e){var t=0,r=0;if(a(e,function(e){t=l(t,e),r++}),0===r)throw new Error("Cannot calculate mean of an empty array");return p(t,r)}var l=n(r(51)),p=n(r(317)),h=u("mean",{"Array | Matrix":f,"Array | Matrix, number | BigNumber":c,"...":function(e){if(s(e))throw new TypeError("Scalar values expected in function mean");return f(e)}});return h.toTex=void 0,h}var i=r(40).size,a=r(312),o=r(313),s=r(314);t.name="mean",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(81)),s=n(r(84)),u=n(r(318)),c=n(r(52)),f=n(r(85)),l=n(r(58)),p=a("divide",i({"Array | Matrix, Array | Matrix":function(e,t){return s(e,u(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,o,!1);break;case"dense":r=l(e,t,o,!1)}return r},"Array, any":function(e,t){return l(c(e),t,o,!1).valueOf()},"any, Array | Matrix":function(e,t){return s(e,u(t))}},o.signatures));return p.toTex={2:"\\frac{${args[0]}}{${args[1]}}"},p}var i=r(3).extend;t.name="divide",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,t,r){var n,i,a,o,s;if(1==t){if(o=e[0][0],0==o)throw Error("Cannot calculate inverse, determinant is zero");return[[u(1,o)]]}if(2==t){var m=p(e);if(0==m)throw Error("Cannot calculate inverse, determinant is zero");return[[u(e[1][1],m),u(l(e[0][1]),m)],[u(l(e[1][0]),m),u(e[0][0],m)]]}var d=e.concat();for(n=0;t>n;n++)d[n]=d[n].concat();for(var g=h(t).valueOf(),v=0;r>v;v++){for(n=v;t>n&&0==d[n][v];)n++;if(n==t||0==d[n][v])throw Error("Cannot calculate inverse, determinant is zero");n!=v&&(s=d[v],d[v]=d[n],d[n]=s,s=g[v],g[v]=g[n],g[n]=s);var y=d[v],x=g[v];for(n=0;t>n;n++){var b=d[n],w=g[n];if(n!=v){if(0!=b[v]){for(a=u(l(b[v]),y[v]),i=v;r>i;i++)b[i]=c(b[i],f(a,y[i]));for(i=0;r>i;i++)w[i]=c(w[i],f(a,x[i]))}}else{for(a=y[v],i=v;r>i;i++)b[i]=u(b[i],a);for(i=0;r>i;i++)w[i]=u(w[i],a)}}}return g}var s=n(r(52)),u=n(r(81)),c=n(r(53)),f=n(r(84)),l=n(r(78)),p=n(r(319)),h=n(r(83)),m=a("inv",{"Array | Matrix":function(e){var t=e.isMatrix===!0?e.size():i.array.size(e);switch(t.length){case 1:if(1==t[0])return e.isMatrix===!0?s([u(1,e.valueOf()[0])]):[u(1,e[0])];throw new RangeError("Matrix must be square (size: "+i.string.format(t)+")");case 2:var r=t[0],n=t[1];if(r==n)return e.isMatrix===!0?s(o(e.valueOf(),r,n),e.storage()):o(e,r,n);throw new RangeError("Matrix must be square (size: "+i.string.format(t)+")");default:throw new RangeError("Matrix must be two dimensional (size: "+i.string.format(t)+")")}},any:function(e){return u(1,e)}});return m.toTex={1:"\\left(${args[0]}\\right)^{-1}"},m}var i=r(39);t.name="inv",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function s(e,t,r){if(1==t)return a.clone(e[0][0]);if(2==t)return f(l(e[0][0],e[1][1]),l(e[1][0],e[0][1]));for(var n=function(e){var t,r,n=new Array(e.length),i=0;for(t=1;t<e.length;t++)i=c(i,e[t][t]);for(t=0;t<e.length;t++){for(n[t]=new Array(e.length),n[t][t]=p(i),r=0;t>r;r++)n[t][r]=0;for(r=t+1;r<e.length;r++)n[t][r]=e[t][r];t+1<e.length&&(i=f(i,e[t+1][t+1]))}return n},i=e,o=0;t-1>o;o++)i=l(n(i),e);return t%2==0?p(i[0][0]):i[0][0]}var u=n(r(52)),c=n(r(51)),f=n(r(77)),l=n(r(84)),p=n(r(78)),h=i("det",{any:function(e){return a.clone(e)},"Array | Matrix":function(e){var t;switch(e&&e.isMatrix===!0?t=e.size():Array.isArray(e)?(e=u(e),t=e.size()):t=[],t.length){case 0:return a.clone(e);case 1:if(1==t[0])return a.clone(e.valueOf()[0]);throw new RangeError("Matrix must be square (size: "+o.format(t)+")");case 2:var r=t[0],n=t[1];if(r==n)return s(e.clone().valueOf(),r,n);throw new RangeError("Matrix must be square (size: "+o.format(t)+")");default:throw new RangeError("Matrix must be two dimensional (size: "+o.format(t)+")")}}});return h.toTex={1:"\\det\\left(${args[0]}\\right)"},h}var i=r(39),a=i.object,o=i.string;t.name="det",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(321));return o("min",{"...any":function(e){if(2==e.length&&a(e[0])){var t=e[1];"number"==typeof t?e[1]=t-1:t&&t.isBigNumber===!0&&(e[1]=t.minus(1))}try{return s.apply(null,e)}catch(r){throw i(r)}}})}var i=r(275).transform,a=r(310);t.name="min",t.path="expression.transform",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,s){function u(e,t){return f(e,t)?e:t}function c(e){var t=void 0;if(i(e,function(e){(void 0===t||f(e,t))&&(t=e)}),void 0===t)throw new Error("Cannot calculate min of an empty array");return t}var f=n(r(60)),l=s("min",{"Array | Matrix":c,"Array | Matrix, number | BigNumber":function(e,t){return a(e,t.valueOf(),u)},"...":function(e){if(o(e))throw new TypeError("Scalar values expected in function min");return c(e)}});return l.toTex="\\min\\left(${args}\\right)",l}var i=r(312),a=r(313),o=r(314);t.name="min",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(323));return i("range",{"...any":function(e){var t=e.length-1,r=e[t];return"boolean"!=typeof r&&e.push(!0),a.apply(null,e)}})}t.name="range",t.path="expression.transform",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e){return"Array"===t.matrix?e:p(e)}function o(r,n){var i=l(r);if(!i)throw new SyntaxError('String "'+r+'" is no valid range');var o;return"BigNumber"===t.number?(o=n?f:c,a(o(new e.BigNumber(i.start),new e.BigNumber(i.end),new e.BigNumber(i.step)))):(o=n?u:s,a(o(i.start,i.end,i.step)))}function s(e,t,r){var n=[],i=e;if(r>0)for(;t>i;)n.push(i),i+=r;else if(0>r)for(;i>t;)n.push(i),i+=r;return n}function u(e,t,r){var n=[],i=e;if(r>0)for(;t>=i;)n.push(i),i+=r;else if(0>r)for(;i>=t;)n.push(i),i+=r;return n}function c(e,t,r){var n=[],i=e;if(r.gt(h))for(;i.lt(t);)n.push(i),i=i.plus(r);else if(r.lt(h))for(;i.gt(t);)n.push(i),i=i.plus(r);return n}function f(e,t,r){var n=[],i=e;if(r.gt(h))for(;i.lte(t);)n.push(i),i=i.plus(r);else if(r.lt(h))for(;i.gte(t);)n.push(i),i=i.plus(r);return n}function l(e){var t=e.split(":"),r=t.map(function(e){return Number(e)}),n=r.some(function(e){return isNaN(e)});if(n)return null;switch(r.length){case 2:return{start:r[0],end:r[1],step:1};case 3:return{start:r[0],end:r[2],step:r[1]};default:return null}}var p=n(r(52)),h=new e.BigNumber(0),m=new e.BigNumber(1),d=i("range",{string:o,"string, boolean":o,"number, number":function(e,t){return a(s(e,t,1))},"number, number, number":function(e,t,r){return a(s(e,t,r))},"number, number, boolean":function(e,t,r){return a(r?u(e,t,1):s(e,t,1))},"number, number, number, boolean":function(e,t,r,n){return a(n?u(e,t,r):s(e,t,r))},"BigNumber, BigNumber":function(e,t){return a(c(e,t,m))},"BigNumber, BigNumber, BigNumber":function(e,t,r){return a(c(e,t,r))},"BigNumber, BigNumber, boolean":function(e,t,r){return a(r?f(e,t,m):c(e,t,m))},"BigNumber, BigNumber, BigNumber, boolean":function(e,t,r,n){return a(n?f(e,t,r):c(e,t,r))}});return d.toTex=void 0,d}t.name="range",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(276));return a("subset",{"...any":function(e){try{return o.apply(null,e)}catch(t){throw i(t)}}})}var i=r(275).transform;t.name="subset",t.path="expression.transform",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(e){if(!(this instanceof s))throw new SyntaxError("Constructor must be called with the new operator");if(!e)throw new Error('Argument "doc" missing');this.doc=e}var u=n(r(295))();return s.prototype.type="Help",s.prototype.isHelp=!0,s.prototype.toString=function(){var e=this.doc||{},t="\n";if(e.name&&(t+="Name: "+e.name+"\n\n"),e.category&&(t+="Category: "+e.category+"\n\n"),e.description&&(t+="Description:\n    "+e.description+"\n\n"),e.syntax&&(t+="Syntax:\n    "+e.syntax.join("\n    ")+"\n\n"),e.examples){t+="Examples:\n";for(var r=0;r<e.examples.length;r++){var n=e.examples[r];t+="    "+n+"\n";var i;try{i=u.eval(n)}catch(o){i=o}i&&!i.isHelp&&(t+="        "+a.format(i,{precision:14})+"\n")}t+="\n"}return e.seealso&&(t+="See also: "+e.seealso.join(", ")+"\n"),t},s.prototype.toJSON=function(){var e=i.clone(this.doc);return e.mathjs="Help",e},s.fromJSON=function(e){var t={};for(var r in e)"mathjs"!==r&&(t[r]=e[r]);return new s(t)},s.prototype.valueOf=s.prototype.toString,s}var i=r(3),a=r(23);t.name="Help",t.path="type",t.factory=n},function(e,t,r){e.exports=[r(327),r(354),r(386),r(402),r(411),r(416),r(419),r(425),r(437),r(446),r(450),r(457),r(459),r(485),r(487)]},function(e,t,r){e.exports=[r(328),r(329),r(349),r(351),r(353)]},function(e,t,r){"use strict";function n(e,t,n,i){var o=n(r(52)),s=n(r(86)),u=n(r(53)),c=n(r(81)),f=n(r(80)),l=n(r(77)),p=n(r(64)),h=n(r(48)),m=n(r(78)),d=e.SparseMatrix,g=e.DenseMatrix,v=e.Spa,y=i("lup",{DenseMatrix:function(e){return x(e)},SparseMatrix:function(e){return b(e)},Array:function(e){var t=o(e),r=x(t);return{L:r.L.valueOf(),U:r.U.valueOf(),p:r.p}}}),x=function(e){var t,r,n,i=e._size[0],o=e._size[1],m=Math.min(i,o),d=a.clone(e._data),v=[],y=[i,m],x=[],b=[m,o],w=[];for(t=0;i>t;t++)w[t]=t;for(r=0;o>r;r++){if(r>0)for(t=0;i>t;t++){var N=Math.min(t,r),E=0;for(n=0;N>n;n++)E=u(E,f(d[t][n],d[n][r]));d[t][r]=l(d[t][r],E)}var M=r,A=0,_=0;for(t=r;i>t;t++){var O=d[t][r],T=s(O);p(T,A)&&(M=t,A=T,_=O)}if(r!==M&&(w[r]=[w[M],w[M]=w[r]][0],g._swapRows(r,M,d)),i>r)for(t=r+1;i>t;t++){var C=d[t][r];h(C,0)||(d[t][r]=c(d[t][r],_))}}for(r=0;o>r;r++)for(t=0;i>t;t++)0===r&&(o>t&&(x[t]=[]),v[t]=[]),r>t?(o>t&&(x[t][r]=d[t][r]),i>r&&(v[t][r]=0)):t!==r?(o>t&&(x[t][r]=0),i>r&&(v[t][r]=d[t][r])):(o>t&&(x[t][r]=d[t][r]),i>r&&(v[t][r]=1));var S=new g({data:v,size:y}),z=new g({data:x,size:b}),B=[];for(t=0,m=w.length;m>t;t++)B[w[t]]=t;return{L:S,U:z,p:B,toString:function(){return"L: "+this.L.toString()+"\nU: "+this.U.toString()+"\nP: "+this.p}}},b=function(e){var t,r,n,i=e._size[0],a=e._size[1],o=Math.min(i,a),u=e._values,l=e._index,g=e._ptr,y=[],x=[],b=[],w=[i,o],N=[],E=[],M=[],A=[o,a],_=[],O=[];for(t=0;i>t;t++)_[t]=t,O[t]=t;var T=function(e,t){var r=O[e],n=O[t];_[r]=t,_[n]=e,O[e]=n,O[t]=r};for(r=0;a>r;r++){var C=new v;i>r&&(b.push(y.length),y.push(1),x.push(r)),M.push(N.length);var S=g[r],z=g[r+1];for(n=S;z>n;n++)t=l[n],C.set(_[t],u[n]);r>0&&C.forEach(0,r-1,function(e,t){d._forEachRow(e,y,x,b,function(r,n){r>e&&C.accumulate(r,m(f(n,t)))})});var B=r,k=C.get(r),I=s(k);C.forEach(r+1,i-1,function(e,t){var r=s(t);p(r,I)&&(B=e,I=r,k=t)}),r!==B&&(d._swapRows(r,B,w[1],y,x,b),d._swapRows(r,B,A[1],N,E,M),C.swap(r,B),T(r,B)),C.forEach(0,i-1,function(e,t){r>=e?(N.push(t),E.push(e)):(t=c(t,k),h(t,0)||(y.push(t),x.push(e)))})}return M.push(N.length),b.push(y.length),{L:new d({values:y,index:x,ptr:b,size:w}),U:new d({values:N,index:E,ptr:M,size:A}),p:_,toString:function(){return"L: "+this.L.toString()+"\nU: "+this.U.toString()+"\nP: "+this.p}}};return y}var i=r(39),a=i.object;t.name="lup",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(330)),s=n(r(341)),u=i("slu",{"SparseMatrix, number, number":function(e,t,r){if(!o(t)||0>t||t>3)throw new Error("Symbolic Ordering and Analysis order must be an integer number in the interval [0, 3]");if(0>r||r>1)throw new Error("Partial pivoting threshold must be a number from 0 to 1");var n=a(t,e,!1),i=s(e,n,r);return{L:i.L,U:i.U,p:i.pinv,q:n.q,toString:function(){return"L: "+this.L.toString()+"\nU: "+this.U.toString()+"\np: "+this.p.toString()+(this.q?"\nq: "+this.q.toString():"")+"\n"}}}});return u}var i=r(39),a=i.number,o=a.isInteger;t.name="slu",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(331)),a=n(r(336)),o=n(r(337)),s=n(r(338)),u=n(r(339)),c=function(e,t,r){var n,c=t._ptr,l=t._size,p=l[1],h={};if(h.q=i(e,t),e&&!h.q)return null;if(r){var m=e?a(t,null,h.q,0):t;h.parent=o(m,1);var d=s(h.parent,p);if(h.cp=u(m,h.parent,d,1),m&&h.parent&&h.cp&&f(m,h))for(h.unz=0,n=0;p>n;n++)h.unz+=h.cp[n]}else h.unz=4*c[p]+p,h.lnz=h.unz;return h},f=function(e,t){var r=e._ptr,n=e._index,i=e._size,a=i[0],o=i[1];t.pinv=[],t.leftmost=[];var s,u,c,f,l,p=t.parent,h=t.pinv,m=t.leftmost,d=[],g=0,v=a,y=a+o,x=a+2*o;for(u=0;o>u;u++)d[v+u]=-1,d[y+u]=-1,d[x+u]=0;for(s=0;a>s;s++)m[s]=-1;for(u=o-1;u>=0;u--)for(f=r[u],l=r[u+1],c=f;l>c;c++)m[n[c]]=u;for(s=a-1;s>=0;s--)h[s]=-1,u=m[s],-1!=u&&(0===d[x+u]++&&(d[y+u]=s),d[g+s]=d[v+u],d[v+u]=s);for(t.lnz=0,t.m2=a,u=0;o>u;u++)if(s=d[v+u],t.lnz++,0>s&&(s=t.m2++),h[s]=u,!(--x[u]<=0)){t.lnz+=d[x+u];var b=p[u];-1!=b&&(0===d[x+b]&&(d[y+b]=d[y+u]),d[g+d[y+u]]=d[v+b],d[v+b]=d[g+s],d[x+b]+=d[x+u])}for(s=0;a>s;s++)h[s]<0&&(h[s]=u++);return!0};return c}t.name="cs_sqr",t.path="sparse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(332)),a=n(r(333)),o=n(r(334)),s=n(r(51)),u=n(r(84)),c=n(r(335)),f=function(e,t){if(!t||0>=e||e>3)return null;var r=t._size,n=r[0],s=r[1],u=0,c=Math.max(16,10*Math.sqrt(s));c=Math.min(s-2,c);var f=l(e,t,n,s,c);a(f,d,null);for(var g,v,y,x,b,w,N,E,M,A,_,O,T,C,S,z,B=f._index,k=f._ptr,I=k[s],R=[],P=[],U=0,q=s+1,L=2*(s+1),j=3*(s+1),F=4*(s+1),D=5*(s+1),$=6*(s+1),G=7*(s+1),H=R,V=p(s,k,P,U,j,H,L,G,q,$,F,D),Z=h(s,k,P,D,F,$,c,q,j,H,L),W=0;s>Z;){for(y=-1;s>W&&-1==(y=P[j+W]);W++);-1!=P[L+y]&&(H[P[L+y]]=-1),P[j+W]=P[L+y];var Y=P[F+y],X=P[q+y];Z+=X;var J=0;P[q+y]=-X;var Q=k[y],K=0===Y?Q:I,ee=K;for(x=1;Y+1>=x;x++){for(x>Y?(w=y,N=Q,E=P[U+y]-Y):(w=B[Q++],N=k[w],E=P[U+w]),b=1;E>=b;b++)g=B[N++],(M=P[q+g])<=0||(J+=M,P[q+g]=-M,B[ee++]=g,-1!=P[L+g]&&(H[P[L+g]]=H[g]),-1!=H[g]?P[L+H[g]]=P[L+g]:P[j+P[D+g]]=P[L+g]);w!=y&&(k[w]=i(y),P[$+w]=0)}for(0!==Y&&(I=ee),P[D+y]=J,k[y]=K,P[U+y]=ee-K,P[F+y]=-2,V=m(V,u,P,$,s),A=K;ee>A;A++)if(g=B[A],!((_=P[F+g])<=0)){M=-P[q+g];var te=V-M;for(Q=k[g],O=k[g]+_-1;O>=Q;Q++)w=B[Q],P[$+w]>=V?P[$+w]-=M:0!==P[$+w]&&(P[$+w]=P[D+w]+te)}for(A=K;ee>A;A++){for(g=B[A],O=k[g],T=O+P[F+g]-1,C=O,S=0,z=0,Q=O;T>=Q;Q++)if(w=B[Q],0!==P[$+w]){var re=P[$+w]-V;re>0?(z+=re,B[C++]=w,S+=w):(k[w]=i(y),P[$+w]=0)}P[F+g]=C-O+1;var ne=C,ie=O+P[U+g];for(Q=T+1;ie>Q;Q++){v=B[Q];var ae=P[q+v];0>=ae||(z+=ae,B[C++]=v,S+=v)}0===z?(k[g]=i(y),M=-P[q+g],J-=M,X+=M,Z+=M,P[q+g]=0,P[F+g]=-1):(P[D+g]=Math.min(P[D+g],z),B[C]=B[ne],B[ne]=B[O],B[O]=y,P[U+g]=C-O+1,S=(0>S?-S:S)%s,P[L+g]=P[G+S],P[G+S]=g,H[g]=S)}for(P[D+y]=J,u=Math.max(u,J),V=m(V+u,u,P,$,s),A=K;ee>A;A++)if(g=B[A],!(P[q+g]>=0))for(S=H[g],g=P[G+S],P[G+S]=-1;-1!=g&&-1!=P[L+g];g=P[L+g],V++){for(E=P[U+g],_=P[F+g],Q=k[g]+1;Q<=k[g]+E-1;Q++)P[$+B[Q]]=V;var oe=g;for(v=P[L+g];-1!=v;){var se=P[U+v]===E&&P[F+v]===_;for(Q=k[v]+1;se&&Q<=k[v]+E-1;Q++)P[$+B[Q]]!=V&&(se=0);se?(k[v]=i(g),P[q+g]+=P[q+v],P[q+v]=0,P[F+v]=-1,v=P[L+v],P[L+oe]=v):(oe=v,v=P[L+v])}}for(Q=K,A=K;ee>A;A++)g=B[A],(M=-P[q+g])<=0||(P[q+g]=M,z=P[D+g]+J-M,z=Math.min(z,s-Z-M),-1!=P[j+z]&&(H[P[j+z]]=g),P[L+g]=P[j+z],H[g]=-1,P[j+z]=g,W=Math.min(W,z),P[D+g]=z,B[Q++]=g);P[q+y]=X,0===(P[U+y]=Q-K)&&(k[y]=-1,P[$+y]=0),0!==Y&&(I=Q)}for(g=0;s>g;g++)k[g]=i(k[g]);for(v=0;s>=v;v++)P[j+v]=-1;for(v=s;v>=0;v--)P[q+v]>0||(P[L+v]=P[j+k[v]],P[j+k[v]]=v);for(w=s;w>=0;w--)P[q+w]<=0||-1!=k[w]&&(P[L+w]=P[j+k[w]],P[j+k[w]]=w);for(y=0,g=0;s>=g;g++)-1==k[g]&&(y=o(g,y,P,j,L,R,$));return R.splice(R.length-1,1),R},l=function(e,t,r,n,i){var a=c(t);if(1===e&&n===r)return s(t,a);if(2==e){for(var o=a._index,f=a._ptr,l=0,p=0;r>p;p++){var h=f[p];if(f[p]=l,!(f[p+1]-h>i))for(var m=f[p+1];m>h;h++)o[l++]=o[h]}return f[r]=l,t=c(a),u(a,t)}return u(a,t)},p=function(e,t,r,n,i,a,o,s,u,c,f,l){for(var p=0;e>p;p++)r[n+p]=t[p+1]-t[p];r[n+e]=0;for(var h=0;e>=h;h++)r[i+h]=-1,a[h]=-1,r[o+h]=-1,r[s+h]=-1,r[u+h]=1,r[c+h]=1,r[f+h]=0,r[l+h]=r[n+h];var d=m(0,0,r,c,e);return r[f+e]=-2,t[e]=-1,r[c+e]=0,d},h=function(e,t,r,n,a,o,s,u,c,f,l){for(var p=0,h=0;e>h;h++){var m=r[n+h];if(0===m)r[a+h]=-2,p++,t[h]=-1,r[o+h]=0;else if(m>s)r[u+h]=0,r[a+h]=-1,p++,t[h]=i(e),r[u+e]++;else{var d=r[c+m];-1!=d&&(f[d]=h),r[l+h]=r[c+m],r[c+m]=h}}return p},m=function(e,t,r,n,i){if(2>e||0>e+t){for(var a=0;i>a;a++)0!==r[n+a]&&(r[n+a]=1);e=2}return e},d=function(e,t){return e!=t};return f}t.name="cs_amd",t.path="sparse",t.factory=n},function(e,t){"use strict";function r(){var e=function(e){return-e-2};return e}t.name="cs_flip",t.path="sparse",t.factory=r},function(e,t){"use strict";function r(){var e=function(e,t,r){for(var n=e._values,i=e._index,a=e._ptr,o=e._size,s=o[1],u=0,c=0;s>c;c++){var f=a[c];for(a[c]=u;f<a[c+1];f++)t(i[f],c,n?n[f]:1,r)&&(i[u]=i[f],n&&(n[u]=n[f]),u++)}return a[s]=u,i.splice(u,i.length-u),n&&n.splice(u,n.length-u),u};return e}t.name="cs_fkeep",t.path="sparse",t.factory=r},function(e,t){"use strict";function r(){var e=function(e,t,r,n,i,a,o){var s=0;for(r[o]=e;s>=0;){var u=r[o+s],c=r[n+u];-1==c?(s--,a[t++]=u):(r[n+u]=r[i+c],++s,r[o+s]=c)}return t};return e}t.name="cs_tdfs",t.path="sparse",t.factory=r},function(e,t,r){"use strict";function n(e,t,n,o){var s=r(32),u=n(r(52)),c=e.DenseMatrix,f=e.SparseMatrix,l=o("transpose",{Array:function(e){return l(u(e)).valueOf()},Matrix:function(e){var t,r=e.size();switch(r.length){case 1:t=e.clone();break;case 2:var n=r[0],i=r[1];if(0===i)throw new RangeError("Cannot transpose a 2D matrix with no columns (size: "+a(r)+")");switch(e.storage()){case"dense":t=p(e,n,i);break;case"sparse":t=h(e,n,i)}break;default:throw new RangeError("Matrix must be a vector or two dimensional (size: "+a(this._size)+")")}return t},any:function(e){return i(e)}}),p=function(e,t,r){for(var n,a=e._data,o=[],s=0;r>s;s++){n=o[s]=[];for(var u=0;t>u;u++)n[u]=i(a[u][s])}return new c({data:o,size:[r,t],datatype:e._datatype})},h=function(e,t,r){for(var n=e._values,a=e._index,o=e._ptr,s=n?[]:void 0,u=[],c=[],l=[],p=0;t>p;p++)l[p]=0;var h,m,d;for(h=0,m=a.length;m>h;h++)l[a[h]]++;for(var g=0,v=0;t>v;v++)c.push(g),g+=l[v],l[v]=c[v];for(c.push(g),d=0;r>d;d++)for(var y=o[d],x=o[d+1],b=y;x>b;b++){var w=l[a[b]]++;u[w]=d,n&&(s[w]=i(n[b]))}return new f({values:s,index:u,ptr:c,size:[r,t],datatype:e._datatype})};return l.toTex={1:"\\left(${args[0]}\\right)"+s.operators.transpose},l}var i=r(3).clone,a=r(23).format;t.name="transpose",t.factory=n},function(e,t){"use strict";function r(e){var t=e.SparseMatrix,r=function(e,r,n,i){for(var a=e._values,o=e._index,s=e._ptr,u=e._size,c=e._datatype,f=u[0],l=u[1],p=i&&e._values?[]:null,h=[],m=[],d=0,g=0;l>g;g++){m[g]=d;for(var v=n?n[g]:g,y=s[v],x=s[v+1],b=y;x>b;b++){var w=r?r[o[b]]:o[b];h[d]=w,p&&(p[d]=a[b]),d++}}return m[l]=d,new t({values:p,index:h,ptr:m,size:[f,l],datatype:c})};return r}t.name="cs_permute",t.path="sparse",t.factory=r},function(e,t){"use strict";function r(){var e=function(e,t){if(!e)return null;var r,n,i=e._index,a=e._ptr,o=e._size,s=o[0],u=o[1],c=[],f=[],l=0,p=u;if(t)for(r=0;s>r;r++)f[p+r]=-1;for(var h=0;u>h;h++){c[h]=-1,f[l+h]=-1;for(var m=a[h],d=a[h+1],g=m;d>g;g++){var v=i[g];for(r=t?f[p+v]:v;-1!=r&&h>r;r=n)n=f[l+r],f[l+r]=h,-1==n&&(c[r]=h);t&&(f[p+v]=h)}}return c};return e}t.name="cs_etree",t.path="sparse",t.factory=r},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(334)),a=function(e,t){if(!e)return null;var r,n=0,a=[],o=[],s=0,u=t,c=2*t;for(r=0;t>r;r++)o[s+r]=-1;for(r=t-1;r>=0;r--)-1!=e[r]&&(o[u+r]=o[s+e[r]],o[s+e[r]]=r);for(r=0;t>r;r++)-1==e[r]&&(n=i(r,n,o,s,u,a,c));return a};return a}t.name="cs_post",t.path="sparse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(335)),a=n(r(340)),o=function(e,t,r,n){if(!e||!t||!r)return null;var o,s,u,c,f,l,p,h=e._size,m=h[0],d=h[1],g=4*d+(n?d+m+1:0),v=[],y=0,x=d,b=2*d,w=3*d,N=4*d,E=5*d+1;for(u=0;g>u;u++)v[u]=-1;var M=[],A=i(e),_=A._index,O=A._ptr;for(u=0;d>u;u++)for(s=r[u],M[s]=-1==v[w+s]?1:0;-1!=s&&-1==v[w+s];s=t[s])v[w+s]=u;if(n){for(u=0;d>u;u++)v[r[u]]=u;for(o=0;m>o;o++){for(u=d,l=O[o],p=O[o+1],f=l;p>f;f++)u=Math.min(u,v[_[f]]);v[E+o]=v[N+u],v[N+u]=o}}for(o=0;d>o;o++)v[y+o]=o;for(u=0;d>u;u++){for(s=r[u],-1!=t[s]&&M[t[s]]--,c=n?v[N+u]:s;-1!=c;c=n?v[E+c]:-1)for(f=O[c];f<O[c+1];f++){o=_[f];var T=a(o,s,v,w,x,b,y);T.jleaf>=1&&M[s]++,2==T.jleaf&&M[T.q]--}-1!=t[s]&&(v[y+s]=t[s])}for(s=0;d>s;s++)-1!=t[s]&&(M[t[s]]+=M[s]);return M};return o}t.name="cs_counts",t.path="sparse",t.factory=n},function(e,t){"use strict";function r(){var e=function(e,t,r,n,i,a,o){var s,u,c,f,l=0;if(t>=e||r[n+t]<=r[i+e])return-1;if(r[i+e]=r[n+t],c=r[a+e],r[a+e]=t,-1===c)l=1,f=e;else{for(l=2,f=c;f!=r[o+f];f=r[o+f]);for(s=c;s!=f;s=u)u=r[o+s],r[o+s]=f}return{jleaf:l,q:f}};return e}t.name="cs_leaf",t.path="sparse",t.factory=r},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(86)),a=n(r(81)),o=n(r(84)),s=n(r(64)),u=n(r(342)),c=n(r(343)),f=e.SparseMatrix,l=function(e,t,r){if(!e)return null;var n,l=e._size,p=l[1],h=100,m=100;t&&(n=t.q,h=t.lnz||h,m=t.unz||m);var d,g,v=[],y=[],x=[],b=new f({values:v,index:y,ptr:x,size:[p,p]}),w=[],N=[],E=[],M=new f({values:w,index:N,ptr:E,size:[p,p]}),A=[],_=[],O=[];for(d=0;p>d;d++)_[d]=0,A[d]=-1,x[d+1]=0;h=0,m=0;for(var T=0;p>T;T++){x[T]=h,E[T]=m;var C=n?n[T]:T,S=c(b,e,C,O,_,A,1),z=-1,B=-1;for(g=S;p>g;g++)if(d=O[g],A[d]<0){var k=i(_[d]);s(k,B)&&(B=k,z=d)}else N[m]=A[d],w[m++]=_[d];if(-1==z||0>=B)return null;A[C]<0&&u(i(_[C]),o(B,r))&&(z=C);var I=_[z];for(N[m]=T,w[m++]=I,A[z]=T,y[h]=z,v[h++]=1,g=S;p>g;g++)d=O[g],A[d]<0&&(y[h]=d,v[h++]=a(_[d],I)),_[d]=0}for(x[p]=h,E[p]=m,g=0;h>g;g++)y[g]=A[y[g]];return v.splice(h,v.length-h),y.splice(h,y.length-h),w.splice(m,w.length-m),N.splice(m,N.length-m),{L:b,U:M,pinv:A}};return l}t.name="cs_lu",t.path="sparse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=n(r(61)),c=n(r(62)),f=n(r(63)),l=n(r(57)),p=n(r(58)),h=r(32),m=o("largerEq",{"boolean, boolean":function(e,t){return e>=t},"number, number":function(e,r){return e>=r||i(e,r,t.epsilon)},"BigNumber, BigNumber":function(e,r){return e.gte(r)||a(e,r,t.epsilon)},"Fraction, Fraction":function(e,t){return-1!==e.compare(t)},"Complex, Complex":function(){throw new TypeError("No ordering relation is defined for complex numbers")},"Unit, Unit":function(e,t){if(!e.equalBase(t))throw new Error("Cannot compare units with different base");return m(e.value,t.value)},"string, string":function(e,t){return e>=t},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,m);break;default:r=u(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,m,!1);break;default:r=l(e,t,m)}}return r},"Array, Array":function(e,t){return m(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return m(s(e),t)},"Matrix, Array":function(e,t){return m(e,s(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,m,!1);break;default:r=p(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,m,!0);break;default:r=p(t,e,m,!0)}return r},"Array, any":function(e,t){return p(s(e),t,m,!1).valueOf()},"any, Array":function(e,t){return p(s(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+h.operators.largerEq+"${args[1]}\\right)"},m}var i=r(6).nearlyEqual,a=r(49);t.name="largerEq",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(81)),a=n(r(84)),o=n(r(77)),s=n(r(344)),u=function(e,t,r,n,u,c,f){var l,p,h,m,d=e._values,g=e._index,v=e._ptr,y=e._size,x=y[1],b=t._values,w=t._index,N=t._ptr,E=s(e,t,r,n,c);for(l=E;x>l;l++)u[n[l]]=0;for(p=N[r],h=N[r+1],l=p;h>l;l++)u[w[l]]=b[l];for(var M=E;x>M;M++){var A=n[M],_=c?c[A]:A;if(!(0>_))for(p=v[_],h=v[_+1],u[A]=i(u[A],d[f?p:h-1]),l=f?p+1:p,m=f?h:h-1;m>l;l++){var O=g[l];u[O]=o(u[O],a(d[l],u[A]))}}return E};return u}t.name="cs_spsolve",t.path="sparse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(345)),a=n(r(346)),o=n(r(347)),s=function(e,t,r,n,s){var u,c,f,l=e._ptr,p=e._size,h=t._index,m=t._ptr,d=p[1],g=d;for(c=m[r],f=m[r+1],u=c;f>u;u++){var v=h[u];a(l,v)||(g=i(v,e,g,n,s))}for(u=g;d>u;u++)o(l,n[u]);return g};return s}t.name="cs_reach",t.path="sparse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(346)),a=n(r(347)),o=n(r(348)),s=function(e,t,r,n,s){var u,c,f,l=t._index,p=t._ptr,h=t._size,m=h[1],d=0;for(n[0]=e;d>=0;){e=n[d];var g=s?s[e]:e;i(p,e)||(a(p,e),n[m+d]=0>g?0:o(p[g]));var v=1;for(c=n[m+d],f=0>g?0:o(p[g+1]);f>c;c++)if(u=l[c],!i(p,u)){n[m+d]=c,n[++d]=u,v=0;break}v&&(d--,n[--r]=e)}return r};return s}t.name="cs_dfs",t.path="sparse",t.factory=n},function(e,t){"use strict";function r(){var e=function(e,t){return e[t]<0};return e}t.name="cs_marked",t.path="sparse",t.factory=r},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(332)),a=function(e,t){e[t]=i(e[t])};return a}t.name="cs_mark",t.path="sparse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n){var i=n(r(332)),a=function(e){return 0>e?i(e):e};return a}t.name="cs_unflip",t.path="sparse",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(52)),o=n(r(81)),s=n(r(80)),u=n(r(77)),c=n(r(48)),f=n(r(350)),l=e.DenseMatrix,p=i("lsolve",{"SparseMatrix, Array | Matrix":function(e,t){return m(e,t)},"DenseMatrix, Array | Matrix":function(e,t){return h(e,t)},"Array, Array | Matrix":function(e,t){var r=a(e),n=h(r,t);return n.valueOf()}}),h=function(e,t){t=f(e,t,!0);for(var r=t._data,n=e._size[0],i=e._size[1],a=[],p=e._data,h=0;i>h;h++){var m,d=r[h][0]||0;if(c(d,0))m=0;else{var g=p[h][h];if(c(g,0))throw new Error("Linear system cannot be solved since matrix is singular");m=o(d,g);for(var v=h+1;n>v;v++)r[v]=[u(r[v][0]||0,s(m,p[v][h]))]}a[h]=[m]}return new l({data:a,size:[n,1]})},m=function(e,t){t=f(e,t,!0);for(var r,n,i=t._data,a=e._size[0],p=e._size[1],h=e._values,m=e._index,d=e._ptr,g=[],v=0;p>v;v++){var y=i[v][0]||0;if(c(y,0))g[v]=[0];else{var x=0,b=[],w=[],N=d[v+1];for(n=d[v];N>n;n++)r=m[n],r===v?x=h[n]:r>v&&(b.push(h[n]),w.push(r));if(c(x,0))throw new Error("Linear system cannot be solved since matrix is singular");var E=o(y,x);for(n=0,N=w.length;N>n;n++)r=w[n],i[r]=[u(i[r][0]||0,s(E,b[n]))];g[v]=[E]}}return new l({data:g,size:[a,1]})};return p}t.name="lsolve",t.factory=n},function(e,t,r){"use strict";function n(e){var t=e.DenseMatrix,r=function(e,r,n){var i=e.size();if(2!==i.length)throw new RangeError("Matrix must be two dimensional (size: "+a.format(i)+")");var u=i[0],c=i[1];if(u!==c)throw new RangeError("Matrix must be square (size: "+a.format(i)+")");var f,l,p;if(r&&r.isMatrix===!0){var h=r.size();if(1===h.length){if(h[0]!==u)throw new RangeError("Dimension mismatch. Matrix columns must match vector length.");for(f=[],p=r._data,l=0;u>l;l++)f[l]=[p[l]];return new t({data:f,size:[u,1],datatype:r._datatype})}if(2===h.length){if(h[0]!==u||1!==h[1])throw new RangeError("Dimension mismatch. Matrix columns must match vector length.");if(r.isDenseMatrix===!0){if(n){for(f=[],p=r._data,l=0;u>l;l++)f[l]=[p[l][0]];return new t({data:f,size:[u,1],datatype:r._datatype})}return r}for(f=[],l=0;u>l;l++)f[l]=[0];for(var m=r._values,d=r._index,g=r._ptr,v=g[1],y=g[0];v>y;y++)l=d[y],f[l][0]=m[y];return new t({data:f,size:[u,1],datatype:r._datatype})}throw new RangeError("Dimension mismatch. Matrix columns must match vector length.")}if(s(r)){var x=o.size(r);if(1===x.length){if(x[0]!==u)throw new RangeError("Dimension mismatch. Matrix columns must match vector length.");for(f=[],l=0;u>l;l++)f[l]=[r[l]];return new t({data:f,size:[u,1]})}if(2===x.length){if(x[0]!==u||1!==x[1])throw new RangeError("Dimension mismatch. Matrix columns must match vector length.");for(f=[],l=0;u>l;l++)f[l]=[r[l][0]];return new t({data:f,size:[u,1]})}throw new RangeError("Dimension mismatch. Matrix columns must match vector length.")}};return r}var i=r(39),a=i.string,o=i.array,s=Array.isArray;t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(52)),s=n(r(328)),u=n(r(329)),c=n(r(352)),f=n(r(350)),l=n(r(353)),p=n(r(349)),h=a("lusolve",{"Array, Array | Matrix":function(e,t){e=o(e);var r=s(e),n=d(r.L,r.U,r.p,null,t);return n.valueOf()},"DenseMatrix, Array | Matrix":function(e,t){var r=s(e);return d(r.L,r.U,r.p,null,t)},"SparseMatrix, Array | Matrix":function(e,t){var r=s(e);return d(r.L,r.U,r.p,null,t)},"SparseMatrix, Array | Matrix, number, number":function(e,t,r,n){var i=u(e,r,n);return d(i.L,i.U,i.p,i.q,t)},"Object, Array | Matrix":function(e,t){return d(e.L,e.U,e.p,e.q,t)}}),m=function(e){if(e&&e.isMatrix===!0)return e;if(i(e))return o(e);throw new TypeError("Invalid Matrix LU decomposition")},d=function(e,t,r,n,i){e=m(e),t=m(t),i=f(e,i,!1),r&&(i._data=c(r,i._data));var a=p(e,i),o=l(t,a);return n&&(o._data=c(n,o._data)),o};return h}var i=Array.isArray;t.name="lusolve",t.factory=n},function(e,t){"use strict";function r(){var e=function(e,t,r){var n,r=t.length,i=[];if(e)for(n=0;r>n;n++)i[e[n]]=t[n];else for(n=0;r>n;n++)i[n]=t[n];return i};return e}t.name="cs_ipvec",t.path="sparse",t.factory=r},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(52)),o=n(r(81)),s=n(r(80)),u=n(r(77)),c=n(r(48)),f=n(r(350)),l=e.DenseMatrix,p=i("usolve",{"SparseMatrix, Array | Matrix":function(e,t){return m(e,t)},"DenseMatrix, Array | Matrix":function(e,t){return h(e,t)},"Array, Array | Matrix":function(e,t){var r=a(e),n=h(r,t);return n.valueOf()}}),h=function(e,t){t=f(e,t,!0);for(var r=t._data,n=e._size[0],i=e._size[1],a=[],p=e._data,h=i-1;h>=0;h--){var m,d=r[h][0]||0;if(c(d,0))m=0;else{var g=p[h][h];if(c(g,0))throw new Error("Linear system cannot be solved since matrix is singular");m=o(d,g);for(var v=h-1;v>=0;v--)r[v]=[u(r[v][0]||0,s(m,p[v][h]))]}a[h]=[m]}return new l({data:a,size:[n,1]})},m=function(e,t){t=f(e,t,!0);for(var r,n,i=t._data,a=e._size[0],p=e._size[1],h=e._values,m=e._index,d=e._ptr,g=[],v=p-1;v>=0;v--){var y=i[v][0]||0;if(c(y,0))g[v]=[0];else{var x=0,b=[],w=[],N=d[v],E=d[v+1];for(n=E-1;n>=N;n--)r=m[n],r===v?x=h[n]:v>r&&(b.push(h[n]),w.push(r));if(c(x,0))throw new Error("Linear system cannot be solved since matrix is singular");var M=o(y,x);for(n=0,E=w.length;E>n;n++)r=w[n],i[r]=[u(i[r][0],s(M,b[n]))];g[v]=[M]}}return new l({data:g,size:[a,1]})};return p}t.name="usolve",t.factory=n},function(e,t,r){e.exports=[r(86),r(51),r(53),r(355),r(357),r(358),r(317),r(359),r(361),r(363),r(364),r(365),r(366),r(367),r(368),r(371),r(374),r(375),r(376),r(84),r(377),r(379),r(82),r(380),r(382),r(369),r(383),r(77),r(78),r(384),r(385)]},function(e,t,r){"use strict";function n(e,t,n,o){function s(r,n){var i=r.arg()/3,o=r.abs(),s=new e.Complex(a(o),0).mul(new e.Complex(0,i).exp());if(n){var u=[s,new e.Complex(a(o),0).mul(new e.Complex(0,i+2*Math.PI/3).exp()),new e.Complex(a(o),0).mul(new e.Complex(0,i-2*Math.PI/3).exp())];return"Array"===t.matrix?u:l(u)}return s}function u(t){if(t.value&&t.value.isComplex){var r=t.clone();return r.value=1,
r=r.pow(1/3),r.value=s(t.value),r}var n=f(t.value);n&&(t.value=c(t.value));var i;i=t.value&&t.value.isBigNumber?new e.BigNumber(1).div(3):t.value&&t.value.isFraction?new e.Fraction(1,3):1/3;var r=t.pow(i);return n&&(r.value=c(r.value)),r}var c=n(r(78)),f=n(r(356)),l=n(r(52)),p=o("cbrt",{number:a,Complex:s,"Complex, boolean":s,BigNumber:function(e){return e.cbrt()},Unit:u,"Array | Matrix":function(e){return i(e,p,!0)}});return p.toTex={1:"\\sqrt[3]{${args[0]}}"},p}var i=r(19),a=Math.cbrt||function(e){if(0===e)return e;var t,r=0>e;return r&&(e=-e),isFinite(e)?(t=Math.exp(Math.log(e)/3),t=(e/(t*t)+2*t)/3):t=e,r?-t:t};t.name="cbrt",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("isNegative",{number:function(e){return 0>e},BigNumber:function(e){return e.isNeg()&&!e.isZero()&&!e.isNaN()},Fraction:function(e){return e.s<0},Unit:function(e){return a(e.value)},"Array | Matrix":function(e){return i(e,a)}});return a}var i=r(19);r(6);t.name="isNegative",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("ceil",{number:Math.ceil,Complex:function(e){return e.ceil()},BigNumber:function(e){return e.ceil()},Fraction:function(e){return e.ceil()},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\left\\lceil${args[0]}\\right\\rceil"},a}var i=r(19);t.name="ceil",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("cube",{number:function(e){return e*e*e},Complex:function(e){return e.mul(e).mul(e)},BigNumber:function(e){return e.times(e).times(e)},Fraction:function(e){return e.pow(3)},"Array | Matrix":function(e){return i(e,a,!0)},Unit:function(e){return e.pow(3)}});return a.toTex={1:"\\left(${args[0]}\\right)^3"},a}var i=r(19);t.name="cube",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(52)),o=n(r(81)),s=r(32),u=n(r(360)),c=n(r(61)),f=n(r(62)),l=n(r(85)),p=n(r(63)),h=n(r(57)),m=n(r(58)),d=i("dotDivide",{"any, any":o,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=f(e,t,o,!1);break;default:r=u(t,e,o,!0)}break;default:switch(t.storage()){case"sparse":r=c(e,t,o,!1);break;default:r=h(e,t,o)}}return r},"Array, Array":function(e,t){return d(a(e),a(t)).valueOf()},"Array, Matrix":function(e,t){return d(a(e),t)},"Matrix, Array":function(e,t){return d(e,a(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=l(e,t,o,!1);break;default:r=m(e,t,o,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=p(t,e,o,!0);break;default:r=m(t,e,o,!0)}return r},"Array, any":function(e,t){return m(a(e),t,o,!1).valueOf()},"any, Array":function(e,t){return m(a(t),e,o,!0).valueOf()}});return d.toTex={2:"\\left(${args[0]}"+s.operators.dotDivide+"${args[1]}\\right)"},d}t.name="dotDivide",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(48)),s=e.SparseMatrix,u=function(e,t,r,n){var u=e._data,c=e._size,f=e._datatype,l=t._values,p=t._index,h=t._ptr,m=t._size,d=t._datatype;if(c.length!==m.length)throw new i(c.length,m.length);if(c[0]!==m[0]||c[1]!==m[1])throw new RangeError("Dimension mismatch. Matrix A ("+c+") must match Matrix B ("+m+")");if(!l)throw new Error("Cannot perform operation on Dense Matrix and Pattern Sparse Matrix");var g,v=c[0],y=c[1],x=o,b=0,w=r;"string"==typeof f&&f===d&&(g=f,x=a.find(o,[g,g]),b=a.convert(0,g),w=a.find(r,[g,g]));for(var N=[],E=[],M=[],A=0;y>A;A++){M[A]=E.length;for(var _=h[A],O=h[A+1],T=_;O>T;T++){var C=p[T],S=n?w(l[T],u[C][A]):w(u[C][A],l[T]);x(S,b)||(E.push(C),N.push(S))}}return M[y]=E.length,new s({values:N,index:E,ptr:M,size:[v,y],datatype:g})};return u}var i=r(42);t.name="algorithm02",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(52)),o=n(r(80)),s=r(32),u=n(r(360)),c=n(r(362)),f=n(r(85)),l=n(r(57)),p=n(r(58)),h=i("dotMultiply",{"any, any":o,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,o,!1);break;default:r=u(t,e,o,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,o,!1);break;default:r=l(e,t,o)}}return r},"Array, Array":function(e,t){return h(a(e),a(t)).valueOf()},"Array, Matrix":function(e,t){return h(a(e),t)},"Matrix, Array":function(e,t){return h(e,a(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,o,!1);break;default:r=p(e,t,o,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,o,!0);break;default:r=p(t,e,o,!0)}return r},"Array, any":function(e,t){return p(a(e),t,o,!1).valueOf()},"any, Array":function(e,t){return p(a(t),e,o,!0).valueOf()}});return h.toTex={2:"\\left(${args[0]}"+s.operators.dotMultiply+"${args[1]}\\right)"},h}t.name="dotMultiply",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(48)),s=e.SparseMatrix,u=function(e,t,r){var n=e._values,u=e._index,c=e._ptr,f=e._size,l=e._datatype,p=t._values,h=t._index,m=t._ptr,d=t._size,g=t._datatype;if(f.length!==d.length)throw new i(f.length,d.length);if(f[0]!==d[0]||f[1]!==d[1])throw new RangeError("Dimension mismatch. Matrix A ("+f+") must match Matrix B ("+d+")");var v,y=f[0],x=f[1],b=o,w=0,N=r;"string"==typeof l&&l===g&&(v=l,b=a.find(o,[v,v]),w=a.convert(0,v),N=a.find(r,[v,v]));var E,M,A,_,O,T=n&&p?[]:void 0,C=[],S=[],z=new s({values:T,index:C,ptr:S,size:[y,x],datatype:v}),B=T?[]:void 0,k=[];for(M=0;x>M;M++){S[M]=C.length;var I=M+1;if(B)for(_=m[M],O=m[M+1],A=_;O>A;A++)E=h[A],k[E]=I,B[E]=p[A];for(_=c[M],O=c[M+1],A=_;O>A;A++)if(E=u[A],B){var R=k[E]===I?B[E]:w,P=N(n[A],R);b(P,w)||(C.push(E),T.push(P))}else C.push(E)}return S[x]=C.length,z};return u}var i=r(42);t.name="algorithm09",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(52)),o=n(r(82)),s=r(32),u=n(r(61)),c=n(r(62)),f=n(r(85)),l=n(r(63)),p=n(r(57)),h=n(r(58)),m=i("dotPow",{"any, any":o,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,o,!1);break;default:r=u(t,e,o,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,o,!1);break;default:r=p(e,t,o)}}return r},"Array, Array":function(e,t){return m(a(e),a(t)).valueOf()},"Array, Matrix":function(e,t){return m(a(e),t)},"Matrix, Array":function(e,t){return m(e,a(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,m,!1);break;default:r=h(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=l(t,e,m,!0);break;default:r=h(t,e,m,!0)}return r},"Array, any":function(e,t){return h(a(e),t,m,!1).valueOf()},"any, Array":function(e,t){return h(a(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+s.operators.dotPow+"${args[1]}\\right)"},m}t.name="dotPow",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("exp",{number:Math.exp,Complex:function(e){return e.exp()},BigNumber:function(e){return e.exp()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\exp\\left(${args[0]}\\right)"},a}var i=r(19);t.name="exp",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("fix",{number:function(e){return e>0?Math.floor(e):Math.ceil(e)},Complex:function(t){return new e.Complex(t.re>0?Math.floor(t.re):Math.ceil(t.re),t.im>0?Math.floor(t.im):Math.ceil(t.im))},BigNumber:function(e){return e.isNegative()?e.ceil():e.floor()},Fraction:function(e){return e.s<0?e.ceil():e.floor()},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\mathrm{${name}}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="fix",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("floor",{number:Math.floor,Complex:function(e){return e.floor()},BigNumber:function(e){return e.floor()},Fraction:function(e){return e.floor()},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\left\\lfloor${args[0]}\\right\\rfloor"},a}var i=r(19);t.name="floor",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(t,r){if(!t.isInt()||!r.isInt())throw new Error("Parameters in function gcd must be integer numbers");for(var n=new e.BigNumber(0);!r.isZero();){var i=t.mod(r);t=r,r=i}return t.lt(n)?t.neg():t}var s=n(r(52)),u=n(r(54)),c=n(r(55)),f=n(r(56)),l=n(r(57)),p=n(r(58)),h=a("gcd",{"number, number":i,"BigNumber, BigNumber":o,"Fraction, Fraction":function(e,t){return e.gcd(t)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,h);break;default:r=u(t,e,h,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,h,!1);break;default:r=l(e,t,h)}}return r},"Array, Array":function(e,t){return h(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return h(s(e),t)},"Matrix, Array":function(e,t){return h(e,s(t))},"Matrix, number | BigNumber":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,h,!1);break;default:r=p(e,t,h,!1)}return r},"number | BigNumber, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,h,!0);break;default:r=p(t,e,h,!0)}return r},"Array, number | BigNumber":function(e,t){return p(s(e),t,h,!1).valueOf()},"number | BigNumber, Array":function(e,t){return p(s(t),e,h,!0).valueOf()},"Array | Matrix | number | BigNumber, Array | Matrix | number | BigNumber, ...Array | Matrix | number | BigNumber":function(e,t,r){for(var n=h(e,t),i=0;i<r.length;i++)n=h(n,r[i]);return n}});return h.toTex="\\gcd\\left(${args}\\right)",h}function i(e,t){if(!a(e)||!a(t))throw new Error("Parameters in function gcd must be integer numbers");for(var r;0!=t;)r=e%t,e=t,t=r;return 0>e?-e:e}var a=r(6).isInteger;t.name="gcd",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e){for(var t=0,r=0,n=0;n<e.length;n++){var i=s(e[n]);p(r,i)?(t=f(t,f(c(r,i),c(r,i))),t=u(t,1),r=i):t=u(t,h(i)?f(c(i,r),c(i,r)):i)}return f(r,l(t))}var s=n(r(86)),u=n(r(53)),c=n(r(81)),f=n(r(80)),l=n(r(369)),p=n(r(60)),h=n(r(370)),m=a("hypot",{"... number | BigNumber":o,Array:function(e){return m.apply(m,i(e))},Matrix:function(e){return m.apply(m,i(e.toArray()))}});return m.toTex="\\hypot\\left(${args}\\right)",m}var i=r(40).flatten;t.name="hypot",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){function a(r){return r>=0||t.predictable?Math.sqrt(r):new e.Complex(r,0).sqrt()}var o=n("sqrt",{number:a,Complex:function(e){return e.sqrt()},BigNumber:function(e){return!e.isNegative()||t.predictable?e.sqrt():a(e.toNumber())},"Array | Matrix":function(e){return i(e,o,!0)},Unit:function(e){return e.pow(.5)}});return o.toTex={1:"\\sqrt{${args[0]}}"},o}var i=r(19);t.name="sqrt",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("isPositive",{number:function(e){return e>0},BigNumber:function(e){return!e.isNeg()&&!e.isZero()&&!e.isNaN()},Fraction:function(e){return e.s>0&&e.n>0},Unit:function(e){return a(e.value)},"Array | Matrix":function(e){return i(e,a)}});return a}var i=r(19);r(6);t.name="isPositive",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(t,r){if(!t.isInt()||!r.isInt())throw new Error("Parameters in function lcm must be integer numbers");if(t.isZero()||r.isZero())return new e.BigNumber(0);for(var n=t.times(r);!r.isZero();){var i=r;r=t.mod(i),t=i}return n.div(t).abs()}var s=n(r(52)),u=n(r(360)),c=n(r(372)),f=n(r(85)),l=n(r(57)),p=n(r(58)),h=a("lcm",{"number, number":i,"BigNumber, BigNumber":o,"Fraction, Fraction":function(e,t){return e.lcm(t)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,h);break;default:r=u(t,e,h,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,h,!1);break;default:r=l(e,t,h)}}return r},"Array, Array":function(e,t){return h(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return h(s(e),t)},"Matrix, Array":function(e,t){return h(e,s(t))},"Matrix, number | BigNumber":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,h,!1);break;default:r=p(e,t,h,!1)}return r},"number | BigNumber, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,h,!0);break;default:r=p(t,e,h,!0)}return r},"Array, number | BigNumber":function(e,t){return p(s(e),t,h,!1).valueOf()},"number | BigNumber, Array":function(e,t){return p(s(t),e,h,!0).valueOf()},"Array | Matrix | number | BigNumber, Array | Matrix | number | BigNumber, ...Array | Matrix | number | BigNumber":function(e,t,r){for(var n=h(e,t),i=0;i<r.length;i++)n=h(n,r[i]);return n}});return h.toTex=void 0,h}function i(e,t){if(!a(e)||!a(t))throw new Error("Parameters in function lcm must be integer numbers");if(0==e||0==t)return 0;for(var r,n=e*t;0!=t;)r=t,t=e%r,e=r;return Math.abs(n/e)}var a=r(6).isInteger;t.name="lcm",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(48)),u=e.SparseMatrix,c=function(e,t,r){var n=e._values,c=e._size,f=e._datatype,l=t._values,p=t._size,h=t._datatype;if(c.length!==p.length)throw new a(c.length,p.length);if(c[0]!==p[0]||c[1]!==p[1])throw new RangeError("Dimension mismatch. Matrix A ("+c+") must match Matrix B ("+p+")");var m,d=c[0],g=c[1],v=s,y=0,x=r;"string"==typeof f&&f===h&&(m=f,v=o.find(s,[m,m]),y=o.convert(0,m),x=o.find(r,[m,m]));for(var b=n&&l?[]:void 0,w=[],N=[],E=new u({values:b,index:w,ptr:N,size:[d,g],datatype:m}),M=b?[]:void 0,A=[],_=[],O=0;g>O;O++){N[O]=w.length;var T=O+1;if(i(e,O,A,M,_,T,E,x),i(t,O,A,M,_,T,E,x),M)for(var C=N[O];C<w.length;){var S=w[C];if(_[S]===T){var z=M[S];v(z,y)?w.splice(C,1):(b.push(z),C++)}else w.splice(C,1)}else for(var B=N[O];B<w.length;){var k=w[B];_[k]!==T?w.splice(B,1):B++}}return N[g]=w.length,E};return c}var i=r(373),a=r(42);t.name="algorithm06",t.factory=n},function(e,t){"use strict";e.exports=function(e,t,r,n,i,a,o,s,u,c,f){var l,p,h,m,d=e._values,g=e._index,v=e._ptr,y=o._index;if(n)for(p=v[t],h=v[t+1],l=p;h>l;l++)m=g[l],r[m]!==a?(r[m]=a,y.push(m),c?(n[m]=u?s(d[l],f):s(f,d[l]),i[m]=a):n[m]=d[l]):(n[m]=u?s(d[l],n[m]):s(n[m],d[l]),i[m]=a);else for(p=v[t],h=v[t+1],l=p;h>l;l++)m=g[l],r[m]!==a?(r[m]=a,y.push(m)):i[m]=a}},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(81)),s=a("log",{number:function(r){return r>=0||t.predictable?Math.log(r):new e.Complex(r,0).log()},Complex:function(e){return e.log()},BigNumber:function(r){return!r.isNegative()||t.predictable?r.ln():new e.Complex(r.toNumber(),0).log()},"Array | Matrix":function(e){return i(e,s)},"any, any":function(e,t){return o(s(e),s(t))}});return s.toTex={1:"\\ln\\left(${args[0]}\\right)",2:"\\log_{${args[1]}}\\left(${args[0]}\\right)"},s}var i=r(19);t.name="log",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("log10",{number:function(r){return r>=0||t.predictable?a(r):new e.Complex(r,0).log().div(Math.LN10)},Complex:function(t){return new e.Complex(t).log().div(Math.LN10)},BigNumber:function(r){return!r.isNegative()||t.predictable?r.log():new e.Complex(r.toNumber(),0).log().div(Math.LN10)},"Array | Matrix":function(e){return i(e,o)}});return o.toTex={1:"\\log_{10}\\left(${args[0]}\\right)"},o}var i=r(19),a=Math.log10||function(e){return Math.log(e)/Math.LN10};t.name="log10",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t){if(t>0)return e-t*Math.floor(e/t);if(0===t)return e;throw new Error("Cannot calculate mod for a negative divisor")}var o=n(r(52)),s=r(32),u=n(r(360)),c=n(r(61)),f=n(r(79)),l=n(r(85)),p=n(r(63)),h=n(r(57)),m=n(r(58)),d=i("mod",{"number, number":a,"BigNumber, BigNumber":function(e,t){return t.isZero()?e:e.mod(t)},"Fraction, Fraction":function(e,t){return e.mod(t)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=f(e,t,d,!1);break;default:r=u(t,e,d,!0)}break;default:switch(t.storage()){case"sparse":r=c(e,t,d,!1);break;default:r=h(e,t,d)}}return r},"Array, Array":function(e,t){return d(o(e),o(t)).valueOf()},"Array, Matrix":function(e,t){return d(o(e),t)},"Matrix, Array":function(e,t){return d(e,o(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=l(e,t,d,!1);break;default:r=m(e,t,d,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=p(t,e,d,!0);break;default:r=m(t,e,d,!0)}return r},"Array, any":function(e,t){return m(o(e),t,d,!1).valueOf()},"any, Array":function(e,t){return m(o(t),e,d,!0).valueOf()}});return d.toTex={2:"\\left(${args[0]}"+s.operators.mod+"${args[1]}\\right)"},d}t.name="mod",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t){var r=e.size();if(1==r.length){if(t===Number.POSITIVE_INFINITY||"inf"===t){var n=0;return e.forEach(function(e){var t=o(e);p(t,n)&&(n=t)},!0),n}if(t===Number.NEGATIVE_INFINITY||"-inf"===t){var i;return e.forEach(function(e){var t=o(e);i&&!h(t,i)||(i=t)},!0),i||0}if("fro"===t)return a(e,2);if("number"==typeof t&&!isNaN(t)){if(!l(t,0)){var m=0;return e.forEach(function(e){m=s(u(o(e),t),m)},!0),u(m,1/t)}return Number.POSITIVE_INFINITY}throw new Error("Unsupported parameter value")}if(2==r.length){if(1===t){var v=[],y=0;return e.forEach(function(e,t){var r=t[1],n=s(v[r]||0,o(e));p(n,y)&&(y=n),v[r]=n},!0),y}if(t===Number.POSITIVE_INFINITY||"inf"===t){var x=[],b=0;return e.forEach(function(e,t){var r=t[0],n=s(x[r]||0,o(e));p(n,b)&&(b=n),x[r]=n},!0),b}if("fro"===t)return c(d(f(g(e),e)));if(2===t)throw new Error("Unsupported parameter value, missing implementation of matrix singular value decomposition");throw new Error("Unsupported parameter value")}}var o=n(r(86)),s=n(r(51)),u=n(r(82)),c=n(r(369)),f=n(r(84)),l=n(r(48)),p=n(r(64)),h=n(r(60)),m=n(r(52)),d=n(r(378)),g=n(r(335)),v=i("norm",{number:Math.abs,Complex:function(e){return e.abs()},BigNumber:function(e){return e.abs()},"boolean | null":function(e){return Math.abs(e)},Array:function(e){return a(m(e),2)},Matrix:function(e){return a(e,2)},"number | Complex | BigNumber | boolean | null, number | BigNumber | string":function(e){return v(e)},"Array, number | BigNumber | string":function(e,t){return a(m(e),t)},"Matrix, number | BigNumber | string":function(e,t){return a(e,t)}});return v.toTex={1:"\\left\\|${args[0]}\\right\\|",2:void 0},v}t.name="norm",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=n(r(51)),c=o("trace",{Array:function(e){return c(s(e))},Matrix:function(e){var t;switch(e.storage()){case"dense":t=f(e);break;case"sparse":t=l(e)}return t},any:i}),f=function(e){var t=e._size,r=e._data;switch(t.length){case 1:if(1==t[0])return i(r[0]);throw new RangeError("Matrix must be square (size: "+a(t)+")");case 2:var n=t[0],o=t[1];if(n===o){for(var s=0,c=0;n>c;c++)s=u(s,r[c][c]);return s}throw new RangeError("Matrix must be square (size: "+a(t)+")");default:throw new RangeError("Matrix must be two dimensional (size: "+a(t)+")")}},l=function(e){var t=e._values,r=e._index,n=e._ptr,i=e._size,o=i[0],s=i[1];if(o===s){var c=0;if(t.length>0)for(var f=0;s>f;f++)for(var l=n[f],p=n[f+1],h=l;p>h;h++){var m=r[h];if(m===f){c=u(c,t[h]);break}if(m>f)break}return c}throw new RangeError("Matrix must be square (size: "+a(i)+")")};return c.toTex={1:"\\mathrm{tr}\\left(${args[0]}\\right)"},c}var i=r(3).clone,a=r(23).format;t.name="trace",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(t,r){var n=e.BigNumber.precision,i=e.BigNumber.clone({precision:n+2}),a=new e.BigNumber(0),o=new i(1),s=r.isNegative();if(s&&(r=r.neg()),r.isZero())throw new Error("Root must be non-zero");if(t.isNegative()&&!r.abs().mod(2).equals(1))throw new Error("Root must be odd when a is negative.");if(t.isZero())return s?new i(1/0):0;if(!t.isFinite())return s?a:t;var u=t.abs().pow(o.div(r));return u=t.isNeg()?u.neg():u,new e.BigNumber((s?o.div(u):u).toPrecision(n))}var u=n(r(52)),c=n(r(54)),f=n(r(360)),l=n(r(372)),p=n(r(85)),h=n(r(57)),m=n(r(58)),d=o("nthRoot",{number:function(e){return i(e,2)},"number, number":i,BigNumber:function(t){return s(t,new e.BigNumber(2))},Complex:function(e){return a(e,2)},"Complex, number":a,"BigNumber, BigNumber":s,"Array | Matrix":function(e){return d(e,2)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":if(1!==t.density())throw new Error("Root must be non-zero");r=l(e,t,d);break;default:r=f(t,e,d,!0)}break;default:switch(t.storage()){case"sparse":if(1!==t.density())throw new Error("Root must be non-zero");r=c(e,t,d,!1);break;default:r=h(e,t,d)}}return r},"Array, Array":function(e,t){return d(u(e),u(t)).valueOf()},"Array, Matrix":function(e,t){return d(u(e),t)},"Matrix, Array":function(e,t){return d(e,u(t))},"Matrix, number | BigNumber":function(e,t){var r;switch(e.storage()){case"sparse":r=p(e,t,d,!1);break;default:r=m(e,t,d,!1)}return r},"number | BigNumber, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":if(1!==t.density())throw new Error("Root must be non-zero");r=p(t,e,d,!0);break;default:r=m(t,e,d,!0)}return r},"Array, number | BigNumber":function(e,t){return d(u(e),t).valueOf()},"number | BigNumber, Array":function(e,t){return d(e,u(t)).valueOf()}});return d.toTex={2:"\\sqrt[${args[1]}]{${args[0]}}"},d}function i(e,t){var r=0>t;if(r&&(t=-t),0===t)throw new Error("Root must be non-zero");if(0>e&&Math.abs(t)%2!=1)throw new Error("Root must be odd when a is negative.");if(0==e)return r?1/0:0;if(!isFinite(e))return r?0:e;var n=Math.pow(Math.abs(e),1/t);return n=0>e?-n:n,r?1/n:n}function a(e,t){if(0>t)throw new Error("Root must be greater than zero");if(0===t)throw new Error("Root must be non-zero");if(t%1!==0)throw new Error("Root must be an integer");for(var r=e.arg(),n=e.abs(),i=[],a=Math.pow(n,1/t),o=0;t>o;o++)i.push({r:a,phi:(r+2*Math.PI*o)/t});return i}t.name="nthRoot",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var c=n(r(52)),f=n(r(48)),l=n(r(381)),p=n(r(85)),h=n(r(63)),m=n(r(58)),d=o("round",{number:Math.round,"number, number":function(e,t){if(!a(t))throw new TypeError(u);if(0>t||t>15)throw new Error("Number of decimals in function round must be in te range of 0-15");return i(e,t)},Complex:function(e){return e.round()},"Complex, number":function(e,t){if(t%1)throw new TypeError(u);return e.round(t)},"Complex, BigNumber":function(e,t){if(!t.isInteger())throw new TypeError(u);var r=t.toNumber();return e.round(r)},"number, BigNumber":function(t,r){if(!r.isInteger())throw new TypeError(u);return new e.BigNumber(t).toDecimalPlaces(r.toNumber())},BigNumber:function(e){return e.toDecimalPlaces(0)},"BigNumber, BigNumber":function(e,t){if(!t.isInteger())throw new TypeError(u);return e.toDecimalPlaces(t.toNumber())},Fraction:function(e){return e.round()},"Fraction, number":function(e,t){if(t%1)throw new TypeError(u);return e.round(t)},"Array | Matrix":function(e){return s(e,d,!0)},"Matrix, number | BigNumber":function(e,t){var r;switch(e.storage()){case"sparse":r=p(e,t,d,!1);break;default:r=m(e,t,d,!1)}return r},"number | Complex | BigNumber, Matrix":function(e,t){if(!f(e,0)){var r;switch(t.storage()){case"sparse":r=h(t,e,d,!0);break;default:r=m(t,e,d,!0)}return r}return l(t.size(),t.storage())},"Array, number | BigNumber":function(e,t){return m(c(e),t,d,!1).valueOf()},"number | Complex | BigNumber, Array":function(e,t){return m(c(t),e,d,!0).valueOf()}});return d.toTex={1:"\\left\\lfloor${args[0]}\\right\\rceil",2:void 0},d}function i(e,t){return parseFloat(o(e,t))}var a=r(6).isInteger,o=r(6).toFixed,s=r(19),u="Number of decimals in function round must be an integer";t.name="round",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(t,r){var n=u(t),i=n?new e.BigNumber(0):0;if(c(t),r){var o=f(r);return t.length>0?o.resize(t,i):o}var s=[];return t.length>0?a(s,t,i):s}function u(e){var t=!1;return e.forEach(function(e,r,n){e&&e.isBigNumber===!0&&(t=!0,n[r]=e.toNumber())}),t}function c(e){e.forEach(function(e){if("number"!=typeof e||!i(e)||0>e)throw new Error("Parameters in function zeros must be positive integers")})}var f=n(r(52)),l=o("zeros",{"":function(){return"Array"===t.matrix?s([]):s([],"default")},"...number | BigNumber | string":function(e){var r=e[e.length-1];if("string"==typeof r){var n=e.pop();return s(e,n)}return"Array"===t.matrix?s(e):s(e,"default")},Array:s,Matrix:function(e){var t=e.storage();return s(e.valueOf(),t)},"Array | Matrix, string":function(e,t){return s(e.valueOf(),t)}});return l.toTex=void 0,l}var i=r(6).isInteger,a=r(40).resize;t.name="zeros",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("sign",{number:i.sign,Complex:function(e){return e.sign()},BigNumber:function(t){return new e.BigNumber(t.cmp(0))},Fraction:function(t){return new e.Fraction(t.s,1)},"Array | Matrix":function(e){return a(e,o,!0)},Unit:function(e){return o(e.value)}});return o.toTex={1:"\\mathrm{${name}}\\left(${args[0]}\\right)"},o}var i=r(6),a=r(19);t.name="sign",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("square",{number:function(e){return e*e},Complex:function(e){return e.mul(e)},BigNumber:function(e){return e.times(e)},Fraction:function(e){return e.mul(e)},"Array | Matrix":function(e){return i(e,a,!0)},Unit:function(e){return e.pow(2)}});return a.toTex={1:"\\left(${args[0]}\\right)^2"},a}var i=r(19);t.name="square",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=r(32),s=a("unaryPlus",{number:function(e){return e},Complex:function(e){return e},BigNumber:function(e){return e},Fraction:function(e){return e},Unit:function(e){return e.clone()},"Array | Matrix":function(e){return i(e,s,!0)},"boolean | string | null":function(r){return"BigNumber"==t.number?new e.BigNumber(+r):+r}});return s.toTex={1:o.operators.unaryPlus+"\\left(${args[0]}\\right)"},s}var i=r(19);t.name="unaryPlus",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,r){var n,a,o,s=0,c=1,f=1,l=0;if(!i(e)||!i(r))throw new Error("Parameters in function xgcd must be integer numbers");for(;r;)a=Math.floor(e/r),o=e%r,n=s,s=c-a*s,c=n,n=f,f=l-a*f,l=n,e=r,r=o;var p;return p=0>e?[-e,-c,-l]:[e,e?c:0,l],"Array"===t.matrix?p:u(p)}function s(r,n){var i,a,o,s=new e.BigNumber(0),c=new e.BigNumber(1),f=s,l=c,p=c,h=s;if(!r.isInt()||!n.isInt())throw new Error("Parameters in function xgcd must be integer numbers");for(;!n.isZero();)a=r.div(n).floor(),o=r.mod(n),i=f,f=l.minus(a.times(f)),l=i,i=p,p=h.minus(a.times(p)),h=i,r=n,n=o;var m;return m=r.lt(s)?[r.neg(),l.neg(),h.neg()]:[r,r.isZero()?0:l,h],"Array"===t.matrix?m:u(m)}var u=n(r(52)),c=a("xgcd",{"number, number":o,"BigNumber, BigNumber":s});return c.toTex=void 0,c}var i=r(6).isInteger;t.name="xgcd",t.factory=n},function(e,t,r){e.exports=[r(387),r(391),r(392),r(394),r(396),r(399),r(401)]},function(e,t,r){"use strict";function n(e,t,n,o){var s=r(32),u=n(r(52)),c=n(r(360)),f=n(r(372)),l=n(r(85)),p=n(r(57)),h=n(r(58)),m=o("bitAnd",{"number, number":function(e,t){if(!i(e)||!i(t))throw new Error("Integers expected in function bitAnd");return e&t},"BigNumber, BigNumber":a,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=f(e,t,m,!1);break;default:r=c(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=c(e,t,m,!1);break;default:r=p(e,t,m)}}return r},"Array, Array":function(e,t){return m(u(e),u(t)).valueOf()},"Array, Matrix":function(e,t){return m(u(e),t)},"Matrix, Array":function(e,t){return m(e,u(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=l(e,t,m,!1);break;default:r=h(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=l(t,e,m,!0);break;default:r=h(t,e,m,!0)}return r},"Array, any":function(e,t){return h(u(e),t,m,!1).valueOf()},"any, Array":function(e,t){return h(u(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+s.operators.bitAnd+"${args[1]}\\right)"},m}var i=r(6).isInteger,a=r(388);t.name="bitAnd",t.factory=n},function(e,t,r){var n=r(389);e.exports=function(e,t){if(e.isFinite()&&!e.isInteger()||t.isFinite()&&!t.isInteger())throw new Error("Integers expected in function bitAnd");var r=e.constructor;if(e.isNaN()||t.isNaN())return new r(NaN);if(e.isZero()||t.eq(-1)||e.eq(t))return e;if(t.isZero()||e.eq(-1))return t;if(!e.isFinite()||!t.isFinite()){if(!e.isFinite()&&!t.isFinite())return e.isNegative()==t.isNegative()?e:new r(0);if(!e.isFinite())return t.isNegative()?e:e.isNegative()?new r(0):t;if(!t.isFinite())return e.isNegative()?t:t.isNegative()?new r(0):e}return n(e,t,function(e,t){return e&t})}},function(e,t,r){function n(e){for(var t=e.d,r=t[0]+"",n=1;n<t.length;++n){for(var i=t[n]+"",a=7-i.length;a--;)i="0"+i;r+=i}var o;for(o=r.length-1;"0"==r.charAt(o);--o);var s=e.e,u=r.slice(0,o+1||1),c=u.length;if(s>0)if(++s>c)for(s-=c;s--;u+="0");else c>s&&(u=u.slice(0,s)+"."+u.slice(s));for(var f=[0],n=0;n<u.length;){for(var l=f.length;l--;f[l]*=10);f[0]+=u.charAt(n++)<<0;for(var o=0;o<f.length;++o)f[o]>1&&(null==f[o+1]&&(f[o+1]=0),f[o+1]+=f[o]>>1,f[o]&=1)}return f.reverse()}var i=r(390);e.exports=function(e,t,r){var a,o,s=e.constructor,u=+(e.s<0),c=+(t.s<0);if(u){a=n(i(e));for(var f=0;f<a.length;++f)a[f]^=1}else a=n(e);if(c){o=n(i(t));for(var f=0;f<o.length;++f)o[f]^=1}else o=n(t);var l,p,h;a.length<=o.length?(l=a,p=o,h=u):(l=o,p=a,h=c);var m=l.length,d=p.length,g=1^r(u,c),v=new s(1^g),y=new s(1),x=new s(2),b=s.precision;for(s.config({precision:1e9});m>0;)r(l[--m],p[--d])==g&&(v=v.plus(y)),y=y.times(x);for(;d>0;)r(h,p[--d])==g&&(v=v.plus(y)),y=y.times(x);return s.config({precision:b}),0==g&&(v.s=-v.s),v}},function(e,t){e.exports=function(e){if(e.isFinite()&&!e.isInteger())throw new Error("Integer expected in function bitNot");var t=e.constructor,r=t.precision;t.config({precision:1e9});var e=e.plus(new t(1));return e.s=-e.s||null,t.config({precision:r}),e}},function(e,t,r){"use strict";function n(e,t,n,s){var u=r(32),c=s("bitNot",{number:function(e){if(!o(e))throw new Error("Integer expected in function bitNot");return~e},BigNumber:a,"Array | Matrix":function(e){return i(e,c)}});return c.toTex={1:u.operators.bitNot+"\\left(${args[0]}\\right)"},c}var i=r(19),a=r(390),o=r(6).isInteger;t.name="bitNot",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=r(32),u=n(r(52)),c=n(r(54)),f=n(r(55)),l=n(r(56)),p=n(r(57)),h=n(r(58)),m=o("bitOr",{"number, number":function(e,t){if(!i(e)||!i(t))throw new Error("Integers expected in function bitOr");return e|t},"BigNumber, BigNumber":a,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=f(e,t,m);break;default:r=c(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=c(e,t,m,!1);break;default:r=p(e,t,m)}}return r},"Array, Array":function(e,t){return m(u(e),u(t)).valueOf()},"Array, Matrix":function(e,t){return m(u(e),t)},"Matrix, Array":function(e,t){return m(e,u(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=l(e,t,m,!1);break;default:r=h(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=l(t,e,m,!0);break;default:r=h(t,e,m,!0)}return r},"Array, any":function(e,t){return h(u(e),t,m,!1).valueOf()},"any, Array":function(e,t){return h(u(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+s.operators.bitOr+"${args[1]}\\right)"},m}var i=r(6).isInteger,a=r(393);t.name="bitOr",t.factory=n},function(e,t,r){var n=r(389);e.exports=function(e,t){if(e.isFinite()&&!e.isInteger()||t.isFinite()&&!t.isInteger())throw new Error("Integers expected in function bitOr");var r=e.constructor;if(e.isNaN()||t.isNaN())return new r(NaN);var i=new r(-1);return e.isZero()||t.eq(i)||e.eq(t)?t:t.isZero()||e.eq(i)?e:e.isFinite()&&t.isFinite()?n(e,t,function(e,t){return e|t}):!e.isFinite()&&!e.isNegative()&&t.isNegative()||e.isNegative()&&!t.isNegative()&&!t.isFinite()?i:e.isNegative()&&t.isNegative()?e.isFinite()?e:t:e.isFinite()?t:e}},function(e,t,r){"use strict";function n(e,t,n,o){var s=r(32),u=n(r(52)),c=n(r(61)),f=n(r(62)),l=n(r(63)),p=n(r(57)),h=n(r(58)),m=o("bitXor",{"number, number":function(e,t){if(!i(e)||!i(t))throw new Error("Integers expected in function bitXor");return e^t},"BigNumber, BigNumber":a,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=f(e,t,m);break;default:r=c(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=c(e,t,m,!1);break;default:r=p(e,t,m)}}return r},"Array, Array":function(e,t){
return m(u(e),u(t)).valueOf()},"Array, Matrix":function(e,t){return m(u(e),t)},"Matrix, Array":function(e,t){return m(e,u(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=l(e,t,m,!1);break;default:r=h(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=l(t,e,m,!0);break;default:r=h(t,e,m,!0)}return r},"Array, any":function(e,t){return h(u(e),t,m,!1).valueOf()},"any, Array":function(e,t){return h(u(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+s.operators.bitXor+"${args[1]}\\right)"},m}var i=r(6).isInteger,a=r(395);t.name="bitXor",t.factory=n},function(e,t,r){var n=r(389),i=r(390);e.exports=function(e,t){if(e.isFinite()&&!e.isInteger()||t.isFinite()&&!t.isInteger())throw new Error("Integers expected in function bitXor");var r=e.constructor;if(e.isNaN()||t.isNaN())return new r(NaN);if(e.isZero())return t;if(t.isZero())return e;if(e.eq(t))return new r(0);var a=new r(-1);return e.eq(a)?i(t):t.eq(a)?i(e):e.isFinite()&&t.isFinite()?n(e,t,function(e,t){return e^t}):e.isFinite()||t.isFinite()?new r(e.isNegative()==t.isNegative()?1/0:-(1/0)):a}},function(e,t,r){"use strict";function n(e,t,n,o){var s=r(32),u=n(r(52)),c=n(r(48)),f=n(r(381)),l=n(r(54)),p=n(r(360)),h=n(r(398)),m=n(r(56)),d=n(r(85)),g=n(r(57)),v=n(r(58)),y=o("leftShift",{"number, number":function(e,t){if(!i(e)||!i(t))throw new Error("Integers expected in function leftShift");return e<<t},"BigNumber, BigNumber":a,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=h(e,t,y,!1);break;default:r=p(t,e,y,!0)}break;default:switch(t.storage()){case"sparse":r=l(e,t,y,!1);break;default:r=g(e,t,y)}}return r},"Array, Array":function(e,t){return y(u(e),u(t)).valueOf()},"Array, Matrix":function(e,t){return y(u(e),t)},"Matrix, Array":function(e,t){return y(e,u(t))},"Matrix, number | BigNumber":function(e,t){if(!c(t,0)){var r;switch(e.storage()){case"sparse":r=d(e,t,y,!1);break;default:r=v(e,t,y,!1)}return r}return e.clone()},"number | BigNumber, Matrix":function(e,t){if(!c(e,0)){var r;switch(t.storage()){case"sparse":r=m(t,e,y,!0);break;default:r=v(t,e,y,!0)}return r}return f(t.size(),t.storage())},"Array, number | BigNumber":function(e,t){return y(u(e),t).valueOf()},"number | BigNumber, Array":function(e,t){return y(e,u(t)).valueOf()}});return y.toTex={2:"\\left(${args[0]}"+s.operators.leftShift+"${args[1]}\\right)"},y}var i=r(6).isInteger,a=r(397);t.name="leftShift",t.factory=n},function(e,t){e.exports=function(e,t){if(e.isFinite()&&!e.isInteger()||t.isFinite()&&!t.isInteger())throw new Error("Integers expected in function leftShift");var r=e.constructor;return e.isNaN()||t.isNaN()||t.isNegative()&&!t.isZero()?new r(NaN):e.isZero()||t.isZero()?e:e.isFinite()||t.isFinite()?t.lt(55)?e.times(Math.pow(2,t.toNumber())+""):e.times(new r(2).pow(t)):new r(NaN)}},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(48)),s=e.SparseMatrix,u=function(e,t,r){var n=e._values,u=e._index,c=e._ptr,f=e._size,l=e._datatype,p=t._values,h=t._index,m=t._ptr,d=t._size,g=t._datatype;if(f.length!==d.length)throw new i(f.length,d.length);if(f[0]!==d[0]||f[1]!==d[1])throw new RangeError("Dimension mismatch. Matrix A ("+f+") must match Matrix B ("+d+")");if(!n||!p)throw new Error("Cannot perform operation on Pattern Sparse Matrices");var v,y=f[0],x=f[1],b=o,w=0,N=r;"string"==typeof l&&l===g&&(v=l,b=a.find(o,[v,v]),w=a.convert(0,v),N=a.find(r,[v,v]));for(var E,M,A,_,O=[],T=[],C=[],S=new s({values:O,index:T,ptr:C,size:[y,x],datatype:v}),z=[],B=[],k=0;x>k;k++){C[k]=T.length;var I=k+1;for(M=c[k],A=c[k+1],E=M;A>E;E++)_=u[E],B[_]=I,z[_]=n[E],T.push(_);for(M=m[k],A=m[k+1],E=M;A>E;E++)_=h[E],B[_]===I&&(z[_]=N(z[_],p[E]));for(E=C[k];E<T.length;){_=T[E];var R=z[_];b(R,w)?T.splice(E,1):(O.push(R),E++)}}return C[x]=T.length,S};return u}var i=r(42);t.name="algorithm08",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=r(32),u=n(r(52)),c=n(r(48)),f=n(r(381)),l=n(r(54)),p=n(r(360)),h=n(r(398)),m=n(r(56)),d=n(r(85)),g=n(r(57)),v=n(r(58)),y=o("rightArithShift",{"number, number":function(e,t){if(!i(e)||!i(t))throw new Error("Integers expected in function rightArithShift");return e>>t},"BigNumber, BigNumber":a,"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=h(e,t,y,!1);break;default:r=p(t,e,y,!0)}break;default:switch(t.storage()){case"sparse":r=l(e,t,y,!1);break;default:r=g(e,t,y)}}return r},"Array, Array":function(e,t){return y(u(e),u(t)).valueOf()},"Array, Matrix":function(e,t){return y(u(e),t)},"Matrix, Array":function(e,t){return y(e,u(t))},"Matrix, number | BigNumber":function(e,t){if(!c(t,0)){var r;switch(e.storage()){case"sparse":r=d(e,t,y,!1);break;default:r=v(e,t,y,!1)}return r}return e.clone()},"number | BigNumber, Matrix":function(e,t){if(!c(e,0)){var r;switch(t.storage()){case"sparse":r=m(t,e,y,!0);break;default:r=v(t,e,y,!0)}return r}return f(t.size(),t.storage())},"Array, number | BigNumber":function(e,t){return y(u(e),t).valueOf()},"number | BigNumber, Array":function(e,t){return y(e,u(t)).valueOf()}});return y.toTex={2:"\\left(${args[0]}"+s.operators.rightArithShift+"${args[1]}\\right)"},y}var i=r(6).isInteger,a=r(400);t.name="rightArithShift",t.factory=n},function(e,t){e.exports=function(e,t){if(e.isFinite()&&!e.isInteger()||t.isFinite()&&!t.isInteger())throw new Error("Integers expected in function rightArithShift");var r=e.constructor;return e.isNaN()||t.isNaN()||t.isNegative()&&!t.isZero()?new r(NaN):e.isZero()||t.isZero()?e:t.isFinite()?t.lt(55)?e.div(Math.pow(2,t.toNumber())+"").floor():e.div(new r(2).pow(t)).floor():new r(e.isNegative()?-1:e.isFinite()?0:NaN)}},function(e,t,r){"use strict";function n(e,t,n,a){var o=r(32),s=n(r(52)),u=n(r(48)),c=n(r(381)),f=n(r(54)),l=n(r(360)),p=n(r(398)),h=n(r(56)),m=n(r(85)),d=n(r(57)),g=n(r(58)),v=a("rightLogShift",{"number, number":function(e,t){if(!i(e)||!i(t))throw new Error("Integers expected in function rightLogShift");return e>>>t},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=p(e,t,v,!1);break;default:r=l(t,e,v,!0)}break;default:switch(t.storage()){case"sparse":r=f(e,t,v,!1);break;default:r=d(e,t,v)}}return r},"Array, Array":function(e,t){return v(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return v(s(e),t)},"Matrix, Array":function(e,t){return v(e,s(t))},"Matrix, number | BigNumber":function(e,t){if(!u(t,0)){var r;switch(e.storage()){case"sparse":r=m(e,t,v,!1);break;default:r=g(e,t,v,!1)}return r}return e.clone()},"number | BigNumber, Matrix":function(e,t){if(!u(e,0)){var r;switch(t.storage()){case"sparse":r=h(t,e,v,!0);break;default:r=g(t,e,v,!0)}return r}return c(t.size(),t.storage())},"Array, number | BigNumber":function(e,t){return v(s(e),t).valueOf()},"number | BigNumber, Array":function(e,t){return v(e,s(t)).valueOf()}});return v.toTex={2:"\\left(${args[0]}"+o.operators.rightLogShift+"${args[1]}\\right)"},v}var i=r(6).isInteger;t.name="rightLogShift",t.factory=n},function(e,t,r){e.exports=[r(403),r(409),r(404),r(410)]},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(51)),o=n(r(404)),s=n(r(356)),u=n(r(408)),c=i("bellNumbers",{"number | BigNumber":function(e){if(!u(e)||s(e))throw new TypeError("Non-negative integer value expected in function bellNumbers");for(var t=0,r=0;e>=r;r++)t=a(t,o(e,r));return t}});return c.toTex={1:"\\mathrm{B}_{${args[0]}}"},c}t.name="bellNumbers",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(51)),o=n(r(77)),s=n(r(84)),u=n(r(317)),c=n(r(82)),f=n(r(405)),l=n(r(407)),p=n(r(356)),h=n(r(408)),m=n(r(64)),d=i("stirlingS2",{"number | BigNumber, number | BigNumber":function(e,t){if(!h(e)||p(e)||!h(t)||p(t))throw new TypeError("Non-negative integer value expected in function stirlingS2");if(m(t,e))throw new TypeError("k must be less than or equal to n in function stirlingS2");for(var r=f(t),n=0,i=0;t>=i;i++){var d=c(-1,o(t,i)),g=l(t,i),v=c(i,e);n=a(n,s(s(g,v),d))}return u(n,r)}});return d.toTex={2:"\\mathrm{S}\\left(${args}\\right)"},d}t.name="stirlingS2",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(406)),s=r(32),u=a("factorial",{number:function(e){if(0>e)throw new Error("Value must be non-negative");return o(e+1)},BigNumber:function(e){if(e.isNegative())throw new Error("Value must be non-negative");return o(e.plus(1))},"Array | Matrix":function(e){return i(e,u)}});return u.toTex={1:"\\left(${args[0]}\\right)"+s.operators.factorial},u}var i=r(19);t.name="factorial",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,u){function c(r){if(r.isZero())return new e.BigNumber(1);for(var n=t.precision+(0|Math.log(r.toNumber())),i=e.BigNumber.clone({precision:n}),a=new i(r),o=r.toNumber()-1;o>1;)a=a.times(o),o--;return new e.BigNumber(a.toPrecision(e.BigNumber.precision))}var f=n(r(84)),l=n(r(82)),p=u("gamma",{number:function(e){var t,r;if(a(e)){if(0>=e)return isFinite(e)?1/0:NaN;if(e>171)return 1/0;for(var n=e-2,i=e-1;n>1;)i*=n,n--;return 0==i&&(i=1),i}if(.5>e)return Math.PI/(Math.sin(Math.PI*e)*p(1-e));if(e>=171.35)return 1/0;if(e>85){var u=e*e,c=u*e,f=c*e,l=f*e;return Math.sqrt(2*Math.PI/e)*Math.pow(e/Math.E,e)*(1+1/(12*e)+1/(288*u)-139/(51840*c)-571/(2488320*f)+163879/(209018880*l)+5246819/(75246796800*l*e))}--e,r=s[0];for(var h=1;h<s.length;++h)r+=s[h]/(e+h);return t=e+o+.5,Math.sqrt(2*Math.PI)*Math.pow(t,e+.5)*Math.exp(-t)*r},Complex:function(t){var r,n;if(0==t.im)return p(t.re);t=new e.Complex(t.re-1,t.im),n=new e.Complex(s[0],0);for(var i=1;i<s.length;++i){var a=t.re+i,u=a*a+t.im*t.im;0!=u?(n.re+=s[i]*a/u,n.im+=-(s[i]*t.im)/u):n.re=s[i]<0?-(1/0):1/0}r=new e.Complex(t.re+o+.5,t.im);var c=Math.sqrt(2*Math.PI);t.re+=.5;var h=l(r,t);0==h.im?h.re*=c:0==h.re?h.im*=c:(h.re*=c,h.im*=c);var m=Math.exp(-r.re);return r.re=m*Math.cos(-r.im),r.im=m*Math.sin(-r.im),f(f(h,r),n)},BigNumber:function(t){if(t.isInteger())return t.isNegative()||t.isZero()?new e.BigNumber(1/0):c(t.minus(1));if(!t.isFinite())return new e.BigNumber(t.isNegative()?NaN:1/0);throw new Error("Integer BigNumber expected")},"Array | Matrix":function(e){return i(e,p)}});return p.toTex={1:"\\Gamma\\left(${args[0]}\\right)"},p}var i=r(19),a=r(6).isInteger,o=4.7421875,s=[.9999999999999971,57.15623566586292,-59.59796035547549,14.136097974741746,-.4919138160976202,3399464998481189e-20,4652362892704858e-20,-9837447530487956e-20,.0001580887032249125,-.00021026444172410488,.00021743961811521265,-.0001643181065367639,8441822398385275e-20,-26190838401581408e-21,36899182659531625e-22];t.name="gamma",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("combinations",{"number, number":function(e,t){var r,n,i;if(!a(e)||0>e)throw new TypeError("Positive integer value expected in function combinations");if(!a(t)||0>t)throw new TypeError("Positive integer value expected in function combinations");if(t>e)throw new TypeError("k must be less than or equal to n");for(r=Math.max(t,e-t),n=1,i=1;e-r>=i;i++)n=n*(r+i)/i;return n},"BigNumber, BigNumber":function(t,r){var n,a,o,s,u=new e.BigNumber(1);if(!i(t)||!i(r))throw new TypeError("Positive integer value expected in function combinations");if(r.gt(t))throw new TypeError("k must be less than n in function combinations");for(n=t.minus(r),r.lt(n)&&(n=r),a=u,o=u,s=t.minus(n);o.lte(s);o=o.plus(1))a=a.times(n.plus(o)).dividedBy(o);return a}});return o.toTex={2:"\\binom{${args[0]}}{${args[1]}}"},o}function i(e){return e.isInteger()&&e.gte(0)}var a=r(6).isInteger;t.name="combinations",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("isInteger",{number:a.isInteger,BigNumber:function(e){return e.isInt()},Fraction:function(e){return 1===e.d&&isFinite(e.n)},"Array | Matrix":function(e){return i(e,o)}});return o}var i=r(19),a=r(6);t.name="isInteger",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(407)),o=n(r(53)),s=n(r(370)),u=n(r(408)),c=n(r(64)),f=i("composition",{"number | BigNumber, number | BigNumber":function(e,t){if(!(u(e)&&s(e)&&u(t)&&s(t)))throw new TypeError("Positive integer value expected in function composition");if(c(t,e))throw new TypeError("k must be less than or equal to n in function composition");return a(o(e,-1),o(t,-1))}});return f.toTex=void 0,f}t.name="composition",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(51)),o=n(r(317)),s=n(r(84)),u=n(r(407)),c=n(r(356)),f=n(r(408)),l=i("catalan",{"number | BigNumber":function(e){if(!f(e)||c(e))throw new TypeError("Non-negative integer value expected in function catalan");return o(u(s(e,2),e),a(e,1))}});return l.toTex={1:"\\mathrm{C}_{${args[0]}}"},l}t.name="catalan",t.factory=n},function(e,t,r){e.exports=[r(412),r(413),r(414),r(415)]},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("arg",{number:function(e){return Math.atan2(0,e)},Complex:function(e){return e.arg()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\arg\\left(${args[0]}\\right)"},a}var i=r(19);t.name="arg",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("conj",{number:function(e){return e},BigNumber:function(e){return e},Complex:function(e){return e.conjugate()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\left(${args[0]}\\right)^*"},a}var i=r(19);t.name="conj",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("im",{number:function(e){return 0},BigNumber:function(t){return new e.BigNumber(0)},Complex:function(e){return e.im},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\Im\\left\\lbrace${args[0]}\\right\\rbrace"},a}var i=r(19);t.name="im",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("re",{number:function(e){return e},BigNumber:function(e){return e},Complex:function(e){return e.re},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\Re\\left\\lbrace${args[0]}\\right\\rbrace"},a}var i=r(19);t.name="re",t.factory=n},function(e,t,r){e.exports=[r(417),r(418)]},function(e,t,r){"use strict";function n(e,t,n,i){function a(e){return 2===e.length&&"number"==typeof e[0]&&"number"==typeof e[1]}function o(e){return 3===e.length&&"number"==typeof e[0]&&"number"==typeof e[1]&&"number"==typeof e[2]}function s(e){return 4===e.length&&"number"==typeof e[0]&&"number"==typeof e[1]&&"number"==typeof e[2]&&"number"==typeof e[3]}function u(e,r,n,i){var a=e,o=n,s=d(a,r),u=d(o,i),c=s[0]*u[1]-u[0]*s[1];if(l(c)<t.epsilon)return null;var f=(u[0]*a[1]-u[1]*a[0]-u[0]*o[1]+u[1]*o[0])/c;return p(m(s,f),a)}function c(e,t,r,n,i,a,o,s,u,c,f,l){var p=(e-o)*(c-o)+(t-s)*(f-s)+(r-u)*(l-u),h=(c-o)*(n-e)+(f-s)*(i-t)+(l-u)*(a-r),m=(e-o)*(n-e)+(t-s)*(i-t)+(r-u)*(a-r),d=(c-o)*(c-o)+(f-s)*(f-s)+(l-u)*(l-u),g=(n-e)*(n-e)+(i-t)*(i-t)+(a-r)*(a-r),v=(p*h-m*d)/(g*d-h*h),y=(p+v*h)/d,x=e+v*(n-e),b=t+v*(i-t),w=r+v*(a-r),N=o+y*(c-o),E=s+y*(f-s),M=u+y*(l-u);return x===N&&b===E&&w===M?[x,b,w]:null}function f(e,t,r,n,i,a,o,s,u,c){var f=(c-e*o-t*s-r*u)/(n*o+i*s+a*u-e-t-r),l=e+f*(n-e),p=t+f*(i-t),h=r+f*(a-r);return[l,p,h]}var l=n(r(86)),p=n(r(51)),h=n(r(52)),m=n(r(84)),d=n(r(77)),g=i("intersect",{"Array, Array, Array":function(e,t,r){if(!o(e))throw new TypeError("Array with 3 numbers expected for first argument");if(!o(t))throw new TypeError("Array with 3 numbers expected for second argument");if(!s(r))throw new TypeError("Array with 4 numbers expected as third argument");return f(e[0],e[1],e[2],t[0],t[1],t[2],r[0],r[1],r[2],r[3])},"Array, Array, Array, Array":function(e,t,r,n){if(2===e.length){if(!a(e))throw new TypeError("Array with 2 numbers expected for first argument");if(!a(t))throw new TypeError("Array with 2 numbers expected for second argument");if(!a(r))throw new TypeError("Array with 2 numbers expected for third argument");if(!a(n))throw new TypeError("Array with 2 numbers expected for fourth argument");return u(e,t,r,n)}if(3===e.length){if(!o(e))throw new TypeError("Array with 3 numbers expected for first argument");if(!o(t))throw new TypeError("Array with 3 numbers expected for second argument");if(!o(r))throw new TypeError("Array with 3 numbers expected for third argument");if(!o(n))throw new TypeError("Array with 3 numbers expected for fourth argument");return c(e[0],e[1],e[2],t[0],t[1],t[2],r[0],r[1],r[2],n[0],n[1],n[2])}throw new TypeError("Arrays with two or thee dimensional points expected")},"Matrix, Matrix, Matrix":function(e,t,r){return h(g(e.valueOf(),t.valueOf(),r.valueOf()))},"Matrix, Matrix, Matrix, Matrix":function(e,t,r,n){return h(g(e.valueOf(),t.valueOf(),r.valueOf(),n.valueOf()))}});return g}t.name="intersect",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,s){var m=(n(r(52)),s("distance",{"Array, Array, Array":function(e,t,r){if(2==e.length&&2==t.length&&2==r.length){if(!i(e))throw new TypeError("Array with 2 numbers expected for first argument");if(!i(t))throw new TypeError("Array with 2 numbers expected for second argument");if(!i(r))throw new TypeError("Array with 2 numbers expected for third argument");var n=(r[1]-r[0])/(t[1]-t[0]),a=n*n*t[0],o=-1*(n*t[0]),s=e[1];return c(e[0],e[1],a,o,s)}throw new TypeError("Invalid Arguments: Try again")},"Object, Object, Object":function(e,t,r){if(2==Object.keys(e).length&&2==Object.keys(t).length&&2==Object.keys(r).length){if(!i(e))throw new TypeError("Values of pointX and pointY should be numbers");if(!i(t))throw new TypeError("Values of lineOnePtX and lineOnePtY should be numbers");if(!i(r))throw new TypeError("Values of lineTwoPtX and lineTwoPtY should be numbers");if(e.hasOwnProperty("pointX")&&e.hasOwnProperty("pointY")&&t.hasOwnProperty("lineOnePtX")&&t.hasOwnProperty("lineOnePtY")&&r.hasOwnProperty("lineTwoPtX")&&r.hasOwnProperty("lineTwoPtY")){var n=(r.lineTwoPtY-r.lineTwoPtX)/(t.lineOnePtY-t.lineOnePtX),a=n*n*t.lineOnePtX,o=-1*(n*t.lineOnePtX),s=e.pointX;return c(e.pointX,e.pointY,a,o,s)}throw new TypeError("Key names do not match")}throw new TypeError("Invalid Arguments: Try again")},"Array, Array":function(e,t){if(2==e.length&&3==t.length){if(!i(e))throw new TypeError("Array with 2 numbers expected for first argument");if(!a(t))throw new TypeError("Array with 3 numbers expected for second argument");return c(e[0],e[1],t[0],t[1],t[2])}if(3==e.length&&6==t.length){if(!a(e))throw new TypeError("Array with 3 numbers expected for first argument");if(!o(t))throw new TypeError("Array with 6 numbers expected for second argument");return f(e[0],e[1],e[2],t[0],t[1],t[2],t[3],t[4],t[5])}if(2==e.length&&2==t.length){if(!i(e))throw new TypeError("Array with 2 numbers expected for first argument");if(!i(t))throw new TypeError("Array with 2 numbers expected for second argument");return l(e[0],e[1],t[0],t[1])}if(3==e.length&&3==t.length){if(!a(e))throw new TypeError("Array with 3 numbers expected for first argument");if(!a(t))throw new TypeError("Array with 3 numbers expected for second argument");return p(e[0],e[1],e[2],t[0],t[1],t[2])}throw new TypeError("Invalid Arguments: Try again")},"Object, Object":function(e,t){if(2==Object.keys(e).length&&3==Object.keys(t).length){if(!i(e))throw new TypeError("Values of pointX and pointY should be numbers");if(!a(t))throw new TypeError("Values of xCoeffLine, yCoeffLine and constant should be numbers");if(e.hasOwnProperty("pointX")&&e.hasOwnProperty("pointY")&&t.hasOwnProperty("xCoeffLine")&&t.hasOwnProperty("yCoeffLine")&&t.hasOwnProperty("yCoeffLine"))return c(e.pointX,e.pointY,t.xCoeffLine,t.yCoeffLine,t.constant);throw new TypeError("Key names do not match")}if(3==Object.keys(e).length&&6==Object.keys(t).length){if(!a(e))throw new TypeError("Values of pointX, pointY and pointZ should be numbers");if(!o(t))throw new TypeError("Values of x0, y0, z0, a, b and c should be numbers");if(e.hasOwnProperty("pointX")&&e.hasOwnProperty("pointY")&&t.hasOwnProperty("x0")&&t.hasOwnProperty("y0")&&t.hasOwnProperty("z0")&&t.hasOwnProperty("a")&&t.hasOwnProperty("b")&&t.hasOwnProperty("c"))return f(e.pointX,e.pointY,e.pointZ,t.x0,t.y0,t.z0,t.a,t.b,t.c);throw new TypeError("Key names do not match")}if(2==Object.keys(e).length&&2==Object.keys(t).length){if(!i(e))throw new TypeError("Values of pointOneX and pointOneY should be numbers");if(!i(t))throw new TypeError("Values of pointTwoX and pointTwoY should be numbers");if(e.hasOwnProperty("pointOneX")&&e.hasOwnProperty("pointOneY")&&t.hasOwnProperty("pointTwoX")&&t.hasOwnProperty("pointTwoY"))return l(e.pointOneX,e.pointOneY,t.pointTwoX,t.pointTwoY);throw new TypeError("Key names do not match")}if(3==Object.keys(e).length&&3==Object.keys(t).length){if(!a(e))throw new TypeError("Values of pointOneX, pointOneY and pointOneZ should be numbers");if(!a(t))throw new TypeError("Values of pointTwoX, pointTwoY and pointTwoZ should be numbers");if(e.hasOwnProperty("pointOneX")&&e.hasOwnProperty("pointOneY")&&e.hasOwnProperty("pointOneZ")&&t.hasOwnProperty("pointTwoX")&&t.hasOwnProperty("pointTwoY")&&t.hasOwnProperty("pointTwoZ"))return p(e.pointOneX,e.pointOneY,e.pointOneZ,t.pointTwoX,t.pointTwoY,t.pointTwoZ);throw new TypeError("Key names do not match")}throw new TypeError("Invalid Arguments: Try again")},Array:function(e){if(!u(e))throw new TypeError("Incorrect array format entered for pairwise distance calculation");return h(e)}}));return m}function i(e){return e.constructor!==Array&&(e=s(e)),"number"==typeof e[0]&&"number"==typeof e[1]}function a(e){return e.constructor!==Array&&(e=s(e)),"number"==typeof e[0]&&"number"==typeof e[1]&&"number"==typeof e[2]}function o(e){return e.constructor!==Array&&(e=s(e)),"number"==typeof e[0]&&"number"==typeof e[1]&&"number"==typeof e[2]&&"number"==typeof e[3]&&"number"==typeof e[4]&&"number"==typeof e[5]}function s(e){for(var t=Object.keys(e),r=[],n=0;n<t.length;n++)r.push(e[t[n]]);return r}function u(e){if(2==e[0].length&&"number"==typeof e[0][0]&&"number"==typeof e[0][1]){for(var t in e)if(2!=e[t].length||"number"!=typeof e[t][0]||"number"!=typeof e[t][1])return!1}else{if(3!=e[0].length||"number"!=typeof e[0][0]||"number"!=typeof e[0][1]||"number"!=typeof e[0][2])return!1;for(var t in e)if(3!=e[t].length||"number"!=typeof e[t][0]||"number"!=typeof e[t][1]||"number"!=typeof e[t][2])return!1}return!0}function c(e,t,r,n,i){var a=Math.abs(r*e+n*t+i),o=Math.pow(r*r+n*n,.5),s=a/o;return s}function f(e,t,r,n,i,a,o,s,u){var c=[(i-t)*u-(a-r)*s,(a-r)*o-(n-e)*u,(n-e)*s-(i-t)*o];c=Math.pow(c[0]*c[0]+c[1]*c[1]+c[2]*c[2],.5);var f=Math.pow(o*o+s*s+u*u,.5),l=c/f;return l}function l(e,t,r,n){var i=n-t,a=r-e,o=i*i+a*a,s=Math.pow(o,.5);return s}function p(e,t,r,n,i,a){var o=a-r,s=i-t,u=n-e,c=o*o+s*s+u*u,f=Math.pow(c,.5);return f}function h(e){for(var t=[],r=0;r<e.length-1;r++)for(var n=r+1;n<e.length;n++)2==e[0].length?t.push(l(e[r][0],e[r][1],e[n][0],e[n][1])):3==e[0].length&&t.push(p(e[r][0],e[r][1],e[r][2],e[n][0],e[n][1],e[n][2]));return t}t.name="distance",t.factory=n},function(e,t,r){e.exports=[r(420),r(421),r(423),r(424)]},function(e,t,r){"use strict";function n(e,t,n,i){var a=r(32),o=n(r(52)),s=n(r(381)),u=n(r(421)),c=(n(r(422)),n(r(360))),f=n(r(372)),l=n(r(85)),p=n(r(57)),h=n(r(58)),m=i("and",{"number, number":function(e,t){return!(!e||!t)},"Complex, Complex":function(e,t){return!(0===e.re&&0===e.im||0===t.re&&0===t.im)},"BigNumber, BigNumber":function(e,t){return!(e.isZero()||t.isZero()||e.isNaN()||t.isNaN())},"Unit, Unit":function(e,t){return m(e.value,t.value)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=f(e,t,m,!1);break;default:r=c(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=c(e,t,m,!1);break;default:r=p(e,t,m)}}return r},"Array, Array":function(e,t){return m(o(e),o(t)).valueOf()},"Array, Matrix":function(e,t){return m(o(e),t)},"Matrix, Array":function(e,t){return m(e,o(t))},"Matrix, any":function(e,t){if(u(t))return s(e.size(),e.storage());var r;switch(e.storage()){case"sparse":r=l(e,t,m,!1);break;default:r=h(e,t,m,!1)}return r},"any, Matrix":function(e,t){if(u(e))return s(e.size(),e.storage());var r;switch(t.storage()){case"sparse":r=l(t,e,m,!0);break;default:r=h(t,e,m,!0)}return r},"Array, any":function(e,t){return m(o(e),t).valueOf()},"any, Array":function(e,t){return m(e,o(t)).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+a.operators.and+"${args[1]}\\right)"},m}t.name="and",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=r(32),s=a("not",{number:function(e){return!e},Complex:function(e){return 0===e.re&&0===e.im},BigNumber:function(e){return e.isZero()||e.isNaN()},Unit:function(e){return s(e.value)},"Array | Matrix":function(e){return i(e,s)}});return s.toTex={1:o.operators.not+"\\left(${args[0]}\\right)"},s}var i=r(19);t.name="not",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("isZero",{number:function(e){return 0===e},BigNumber:function(e){return e.isZero()},Complex:function(e){return 0===e.re&&0===e.im},Fraction:function(e){return 1===e.d&&0===e.n},Unit:function(e){return a(e.value)},"Array | Matrix":function(e){return i(e,a)}});return a}var i=r(19);r(6);t.name="isZero",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=r(32),o=n(r(52)),s=n(r(61)),u=n(r(79)),c=n(r(63)),f=n(r(57)),l=n(r(58)),p=i("or",{"number, number":function(e,t){return!(!e&&!t)},"Complex, Complex":function(e,t){return 0!==e.re||0!==e.im||0!==t.re||0!==t.im},"BigNumber, BigNumber":function(e,t){return!e.isZero()&&!e.isNaN()||!t.isZero()&&!t.isNaN()},"Unit, Unit":function(e,t){return p(e.value,t.value)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=u(e,t,p);break;default:r=s(t,e,p,!0)}break;default:switch(t.storage()){case"sparse":r=s(e,t,p,!1);break;default:r=f(e,t,p)}}return r},"Array, Array":function(e,t){return p(o(e),o(t)).valueOf()},"Array, Matrix":function(e,t){return p(o(e),t)},"Matrix, Array":function(e,t){return p(e,o(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=c(e,t,p,!1);break;default:r=l(e,t,p,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=c(t,e,p,!0);break;default:r=l(t,e,p,!0)}return r},"Array, any":function(e,t){return l(o(e),t,p,!1).valueOf()},"any, Array":function(e,t){return l(o(t),e,p,!0).valueOf()}});return p.toTex={2:"\\left(${args[0]}"+a.operators.or+"${args[1]}\\right)"},p}t.name="or",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=r(32),o=n(r(52)),s=n(r(61)),u=n(r(62)),c=n(r(63)),f=n(r(57)),l=n(r(58)),p=i("xor",{"number, number":function(e,t){return!!(!!e^!!t)},"Complex, Complex":function(e,t){return(0!==e.re||0!==e.im)!=(0!==t.re||0!==t.im)},"BigNumber, BigNumber":function(e,t){return(!e.isZero()&&!e.isNaN())!=(!t.isZero()&&!t.isNaN())},"Unit, Unit":function(e,t){return p(e.value,t.value)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=u(e,t,p);break;default:r=s(t,e,p,!0)}break;default:switch(t.storage()){case"sparse":r=s(e,t,p,!1);break;default:r=f(e,t,p)}}return r},"Array, Array":function(e,t){return p(o(e),o(t)).valueOf()},"Array, Matrix":function(e,t){return p(o(e),t)},"Matrix, Array":function(e,t){return p(e,o(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=c(e,t,p,!1);break;default:r=l(e,t,p,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=c(t,e,p,!0);break;default:r=l(t,e,p,!0)}return r},"Array, any":function(e,t){return l(o(e),t,p,!1).valueOf()},"any, Array":function(e,t){return l(o(t),e,p,!0).valueOf()}});return p.toTex={2:"\\left(${args[0]}"+a.operators.xor+"${args[1]}\\right)"},p}t.name="xor",t.factory=n},function(e,t,r){e.exports=[r(301),r(426),r(319),r(427),r(428),r(83),r(303),r(429),r(305),r(318),r(308),r(430),r(431),r(323),r(433),r(434),r(435),r(436),r(276),r(378),r(335),r(381)]},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,t){var r=i(e),n=i(t);if(1!=r.length||1!=n.length||3!=r[0]||3!=n[0])throw new RangeError("Vectors with length 3 expected (Size A = ["+r.join(", ")+"], B = ["+n.join(", ")+"])");return[u(c(e[1],t[2]),c(e[2],t[1])),u(c(e[2],t[0]),c(e[0],t[2])),u(c(e[0],t[1]),c(e[1],t[0]))]}var s=n(r(52)),u=n(r(77)),c=n(r(84)),f=a("cross",{"Matrix, Matrix":function(e,t){return s(o(e.toArray(),t.toArray()))},"Matrix, Array":function(e,t){return s(o(e.toArray(),t))},"Array, Matrix":function(e,t){return s(o(e,t.toArray()))},"Array, Array":o});return f.toTex={2:"\\left(${args[0]}\\right)\\times\\left(${args[1]}\\right)"},f}var i=r(40).size;t.name="cross",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(e,t,r,n){if(!a(t))throw new TypeError("Second parameter in function diag must be an integer");var i=t>0?t:0,o=0>t?-t:0;switch(r.length){case 1:return u(e,t,n,r[0],o,i);case 2:return c(e,t,n,r,o,i)}throw new RangeError("Matrix for function diag must be 2 dimensional")}function u(t,r,n,i,a,o){var s=[i+a,i+o],u=e.Matrix.storage(n||"dense"),c=u.diagonal(s,t,r);return null!==n?c:c.valueOf()}function c(e,t,r,n,i,a){if(e&&e.isMatrix===!0){var o=e.diagonal(t);return null!==r?r!==o.storage()?f(o,r):o:o.valueOf()}for(var s=Math.min(n[0]-i,n[1]-a),u=[],c=0;s>c;c++)u[c]=e[c+i][c+a];return null!==r?f(u):u}var f=n(r(52)),l=o("diag",{Array:function(e){return s(e,0,i.size(e),null)},"Array, number":function(e,t){return s(e,t,i.size(e),null)},"Array, BigNumber":function(e,t){return s(e,t.toNumber(),i.size(e),null)},"Array, string":function(e,t){return s(e,0,i.size(e),t)},"Array, number, string":function(e,t,r){return s(e,t,i.size(e),r)},"Array, BigNumber, string":function(e,t,r){return s(e,t.toNumber(),i.size(e),r)},Matrix:function(e){return s(e,0,e.size(),e.storage())},"Matrix, number":function(e,t){return s(e,t,e.size(),e.storage())},"Matrix, BigNumber":function(e,t){return s(e,t.toNumber(),e.size(),e.storage())},"Matrix, string":function(e,t){return s(e,0,e.size(),t)},"Matrix, number, string":function(e,t,r){return s(e,t,e.size(),r)},"Matrix, BigNumber, string":function(e,t,r){return s(e,t.toNumber(),e.size(),r)}});return l.toTex=void 0,l}var i=r(40),a=(r(3).clone,r(6).isInteger);t.name="diag",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,t){var r=i(e),n=i(t),a=r[0];if(1!==r.length||1!==n.length)throw new RangeError("Vector expected");if(r[0]!=n[0])throw new RangeError("Vectors must have equal length ("+r[0]+" != "+n[0]+")");if(0==a)throw new RangeError("Cannot calculate the dot product of empty vectors");for(var o=0,c=0;a>c;c++)o=s(o,u(e[c],t[c]));return o}var s=n(r(51)),u=n(r(84)),c=a("dot",{"Matrix, Matrix":function(e,t){return o(e.toArray(),t.toArray())},"Matrix, Array":function(e,t){return o(e.toArray(),t)},"Array, Matrix":function(e,t){return o(e,t.toArray())},"Array, Array":o});return c.toTex={2:"\\left(${args[0]}\\cdot${args[1]}\\right)"},c}var i=r(40).size;t.name="dot",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=o("flatten",{Array:function(e){return a(i(e))},Matrix:function(e){var t=a(i(e.toArray()));return s(t)}});return u.toTex=void 0,u}var i=r(3).clone,a=r(40).flatten;t.name="flatten",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(t,r){var n=u(t),i=n?new e.BigNumber(1):1;if(c(t),r){var o=f(r);return t.length>0?o.resize(t,i):o}var s=[];return t.length>0?a(s,t,i):s}function u(e){var t=!1;return e.forEach(function(e,r,n){e&&e.isBigNumber===!0&&(t=!0,n[r]=e.toNumber())}),t}function c(e){e.forEach(function(e){if("number"!=typeof e||!i(e)||0>e)throw new Error("Parameters in function ones must be positive integers")})}var f=n(r(52)),l=o("ones",{"":function(){return"Array"===t.matrix?s([]):s([],"default")},"...number | BigNumber | string":function(e){var r=e[e.length-1];if("string"==typeof r){var n=e.pop();return s(e,n)}return"Array"===t.matrix?s(e):s(e,"default")},Array:s,Matrix:function(e){var t=e.storage();return s(e.valueOf(),t)},"Array | Matrix, string":function(e,t){return s(e.valueOf(),t)}});return l.toTex=void 0,l}var i=r(6).isInteger,a=r(40).resize;t.name="ones",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e,t){return-c(e,t)}function s(e,t,r){
if(!i(t)||0>t)throw new Error("k must be a non-negative integer");if(e&&e.isMatrix){var n=e.size();if(n.length>1)throw new Error("Only one dimensional matrices supported");return u(e.valueOf(),t,r)}return Array.isArray(e)?u(e,t,r):void 0}function u(e,t,r){if(t>=e.length)throw new Error("k out of bounds");for(var n=0,i=e.length-1;i>n;){for(var a=n,o=i,s=e[Math.floor(Math.random()*(i-n+1))+n];o>a;)if(r(e[a],s)>=0){var u=e[o];e[o]=e[a],e[a]=u,--o}else++a;r(e[a],s)>0&&--a,a>=t?i=a:n=a+1}return e[t]}var c=n(r(432));return a("partitionSelect",{"Array | Matrix, number":function(e,t){return s(e,t,c)},"Array | Matrix, number, string":function(e,t,r){if("asc"===r)return s(e,t,c);if("desc"===r)return s(e,t,o);throw new Error('Compare string must be "asc" or "desc"')},"Array | Matrix, number, function":s})}var i=r(6).isInteger;t.name="partitionSelect",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=n(r(61)),c=n(r(79)),f=n(r(63)),l=n(r(57)),p=n(r(58)),h=o("compare",{"boolean, boolean":function(e,t){return e===t?0:e>t?1:-1},"number, number":function(e,r){return e===r||i(e,r,t.epsilon)?0:e>r?1:-1},"BigNumber, BigNumber":function(r,n){return r.eq(n)||a(r,n,t.epsilon)?new e.BigNumber(0):new e.BigNumber(r.cmp(n))},"Fraction, Fraction":function(t,r){return new e.Fraction(t.compare(r))},"Complex, Complex":function(){throw new TypeError("No ordering relation is defined for complex numbers")},"Unit, Unit":function(e,t){if(!e.equalBase(t))throw new Error("Cannot compare units with different base");return h(e.value,t.value)},"string, string":function(e,t){return e===t?0:e>t?1:-1},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,h);break;default:r=u(t,e,h,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,h,!1);break;default:r=l(e,t,h)}}return r},"Array, Array":function(e,t){return h(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return h(s(e),t)},"Matrix, Array":function(e,t){return h(e,s(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,h,!1);break;default:r=p(e,t,h,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,h,!0);break;default:r=p(t,e,h,!0)}return r},"Array, any":function(e,t){return p(s(e),t,h,!1).valueOf()},"any, Array":function(e,t){return p(s(t),e,h,!0).valueOf()}});return h.toTex=void 0,h}var i=r(6).nearlyEqual,a=r(49);t.name="compare",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,f){function l(e,t,r){if(void 0!==r){if("string"!=typeof r||1!==r.length)throw new TypeError("Single character expected as defaultValue")}else r=" ";if(1!==t.length)throw new i(t.length,1);var n=t[0];if("number"!=typeof n||!o(n))throw new TypeError("Invalid size, must contain positive integers (size: "+s(t)+")");if(e.length>n)return e.substring(0,n);if(e.length<n){for(var a=e,u=0,c=n-e.length;c>u;u++)a+=r;return a}return e}var p=n(r(52)),h=function(e,r,n){if(2!=arguments.length&&3!=arguments.length)throw new a("resize",arguments.length,2,3);if(r&&r.isMatrix===!0&&(r=r.valueOf()),r.length&&r[0]&&r[0].isBigNumber===!0&&(r=r.map(function(e){return e&&e.isBigNumber===!0?e.toNumber():e})),e&&e.isMatrix===!0)return e.resize(r,n,!0);if("string"==typeof e)return l(e,r,n);var i=Array.isArray(e)?!1:"Array"!==t.matrix;if(0==r.length){for(;Array.isArray(e);)e=e[0];return u(e)}Array.isArray(e)||(e=[e]),e=u(e);var o=c.resize(e,r,n);return i?p(o):o};return h.toTex=void 0,h}var i=r(42),a=r(11),o=r(6).isInteger,s=r(23).format,u=r(3).clone,c=r(40);t.name="resize",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(52)),s=a("size",{Matrix:function(e){return o(e.size())},Array:i.size,string:function(e){return"Array"===t.matrix?[e.length]:o([e.length])},"number | Complex | BigNumber | Unit | boolean | null":function(e){return"Array"===t.matrix?[]:o([])}});return s.toTex=void 0,s}var i=r(40);t.name="size",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e){if("asc"===e)return f;if("desc"===e)return l;throw new Error('String "asc" or "desc" expected')}function s(e){if(1!==i(e).length)throw new Error("One dimensional array expected")}function u(e){if(1!==e.size().length)throw new Error("One dimensional matrix expected")}var c=n(r(52)),f=n(r(432)),l=function(e,t){return-f(e,t)},p=a("sort",{Array:function(e){return s(e),e.sort(f)},Matrix:function(e){return u(e),c(e.toArray().sort(f),e.storage())},"Array, function":function(e,t){return s(e),e.sort(t)},"Matrix, function":function(e,t){return u(e),c(e.toArray().sort(t),e.storage())},"Array, string":function(e,t){return s(e),e.sort(o(t))},"Matrix, string":function(e,t){return u(e),c(e.toArray().sort(o(t)),e.storage())}});return p.toTex=void 0,p}var i=r(40).size;t.name="sort",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=o("squeeze",{Array:function(e){return a.squeeze(i.clone(e))},Matrix:function(e){var t=a.squeeze(e.toArray());return Array.isArray(t)?s(t):t},any:function(e){return i.clone(e)}});return u.toTex=void 0,u}var i=r(3),a=r(40);t.name="squeeze",t.factory=n},function(e,t,r){e.exports=[r(407),r(405),r(406),r(438),r(440),r(441),r(442),r(444),r(445)]},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t){var r=t.size().length,n=e.size().length;if(r>1)throw new Error("first object must be one dimensional");if(n>1)throw new Error("second object must be one dimensional");if(r!==n)throw new Error("Length of two vectors must be equal");var i=u(e);if(0===i)throw new Error("Sum of elements in first object must be non zero");var a=u(t);if(0===a)throw new Error("Sum of elements in second object must be non zero");var o=s(e,u(e)),h=s(t,u(t)),m=u(c(o,l(f(o,h))));return p(m)?m:Number.NaN}var o=n(r(52)),s=n(r(317)),u=n(r(439)),c=n(r(84)),f=n(r(359)),l=n(r(374)),p=n(r(88)),h=i("kldivergence",{"Array, Array":function(e,t){return a(o(e),o(t))},"Matrix, Array":function(e,t){return a(e,o(t))},"Array, Matrix":function(e,t){return a(o(e),t)},"Matrix, Matrix":function(e,t){return a(e,t)}});return h}t.name="kldivergence",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(r){var n=void 0;if(i(r,function(e){n=void 0===n?e:s(n,e)}),void 0===n)switch(t.number){case"number":return 0;case"BigNumber":return new e.BigNumber(0);case"Fraction":return new e.Fraction(0);default:return 0}return n}var s=n(r(53)),u=a("sum",{"Array | Matrix":function(e){return o(e)},"Array | Matrix, number | BigNumber":function(){throw new Error("sum(A, dim) is not yet supported")},"...":function(e){return o(e)}});return u.toTex=void 0,u}var i=r(312);t.name="sum",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=n(r(51)),s=n(r(84)),u=n(r(317)),c=n(r(405)),f=n(r(408)),l=n(r(370));return a("multinomial",{"Array | Matrix":function(e){var t=0,r=1;return i(e,function(e){if(!f(e)||!l(e))throw new TypeError("Positive integer value expected in function multinomial");t=o(t,e),r=s(r,c(e))}),u(c(t),r)}})}var i=r(312);t.name="multinomial",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(405)),u=o("permutations",{"number | BigNumber":s,"number, number":function(e,t){var r,n;if(!a(e)||0>e)throw new TypeError("Positive integer value expected in function permutations");if(!a(t)||0>t)throw new TypeError("Positive integer value expected in function permutations");if(t>e)throw new TypeError("second argument k must be less than or equal to first argument n");for(r=1,n=e-t+1;e>=n;n++)r*=n;return r},"BigNumber, BigNumber":function(t,r){var n,a;if(!i(t)||!i(r))throw new TypeError("Positive integer value expected in function permutations");if(r.gt(t))throw new TypeError("second argument k must be less than or equal to first argument n");for(n=new e.BigNumber(1),a=t.minus(r).plus(1);a.lte(t);a=a.plus(1))n=n.times(a);return n}});return u.toTex=void 0,u}function i(e){return e.isInteger()&&e.gte(0)}var a=r(6).isInteger;t.name="permutations",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(443)),o=a("uniform").pickRandom;return o.toTex=void 0,o}t.name="pickRandom",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(e){if(!f.hasOwnProperty(e))throw new Error("Unknown distribution "+e);var t=Array.prototype.slice.call(arguments,1),r=f[e].apply(this,t);return function(e){var t={random:function(e,t,n){var s,c,f;if(arguments.length>3)throw new i("random",arguments.length,0,3);if(1===arguments.length?a(e)?s=e:f=e:2===arguments.length?a(e)?(s=e,f=t):(c=e,f=t):(s=e,c=t,f=n),void 0===f&&(f=1),void 0===c&&(c=0),void 0!==s){var l=o(s.valueOf(),c,f,r);return s&&s.isMatrix===!0?u(l):l}return r(c,f)},randomInt:function(e,t,r){var s,c,f;if(arguments.length>3||arguments.length<1)throw new i("randomInt",arguments.length,1,3);if(1===arguments.length?a(e)?s=e:f=e:2===arguments.length?a(e)?(s=e,f=t):(c=e,f=t):(s=e,c=t,f=r),void 0===c&&(c=0),void 0!==s){var l=o(s.valueOf(),c,f,n);return s&&s.isMatrix===!0?u(l):l}return n(c,f)},pickRandom:function(e){if(1!==arguments.length)throw new i("pickRandom",arguments.length,1);if(e&&e.isMatrix===!0)e=e.valueOf();else if(!Array.isArray(e))throw new TypeError("Unsupported type of value in function pickRandom");if(c.size(e).length>1)throw new Error("Only one dimensional vectors supported");return e[Math.floor(Math.random()*e.length)]}},r=function(t,r){return t+e()*(r-t)},n=function(t,r){return Math.floor(t+e()*(r-t))},o=function(e,t,r,n){var i,a,s=[];if(e=e.slice(0),e.length>1)for(a=0,i=e.shift();i>a;a++)s.push(o(e,t,r,n));else for(a=0,i=e.shift();i>a;a++)s.push(n(t,r));return s};return t}(r)}var u=n(r(52)),c=r(40),f={uniform:function(){return Math.random},normal:function(){return function(){for(var e,t,r=-1;0>r||r>1;)e=Math.random(),t=Math.random(),r=1/6*Math.pow(-2*Math.log(e),.5)*Math.cos(2*Math.PI*t)+.5;return r}}};return s.toTex=void 0,s}var i=r(11),a=r(310);t.name="distribution",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(443)),o=a("uniform").random;return o.toTex=void 0,o}t.name="random",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(443)),o=a("uniform").randomInt;return o.toTex=void 0,o}t.name="randomInt",t.factory=n},function(e,t,r){e.exports=[r(432),r(447),r(87),r(64),r(342),r(60),r(448),r(449)]},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t){if(Array.isArray(e)){if(Array.isArray(t)){var r=e.length;if(r!==t.length)return!1;for(var n=0;r>n;n++)if(!a(e[n],t[n]))return!1;return!0}return!1}return Array.isArray(t)?!1:o(e,t)}var o=n(r(87)),s=i("deepEqual",{"any, any":function(e,t){return a(e.valueOf(),t.valueOf())}});return s.toTex=void 0,s}t.name="deepEqual",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=n(r(61)),c=n(r(62)),f=n(r(63)),l=n(r(57)),p=n(r(58)),h=r(32),m=o("smallerEq",{"boolean, boolean":function(e,t){return t>=e},"number, number":function(e,r){return r>=e||i(e,r,t.epsilon)},"BigNumber, BigNumber":function(e,r){return e.lte(r)||a(e,r,t.epsilon)},"Fraction, Fraction":function(e,t){return 1!==e.compare(t)},"Complex, Complex":function(){throw new TypeError("No ordering relation is defined for complex numbers")},"Unit, Unit":function(e,t){if(!e.equalBase(t))throw new Error("Cannot compare units with different base");return m(e.value,t.value)},"string, string":function(e,t){return t>=e},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,m);break;default:r=u(t,e,m,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,m,!1);break;default:r=l(e,t,m)}}return r},"Array, Array":function(e,t){return m(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return m(s(e),t)},"Matrix, Array":function(e,t){return m(e,s(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,m,!1);break;default:r=p(e,t,m,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,m,!0);break;default:r=p(t,e,m,!0)}return r},"Array, any":function(e,t){return p(s(e),t,m,!1).valueOf()},"any, Array":function(e,t){return p(s(t),e,m,!0).valueOf()}});return m.toTex={2:"\\left(${args[0]}"+h.operators.smallerEq+"${args[1]}\\right)"},m}var i=r(6).nearlyEqual,a=r(49);t.name="smallerEq",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){var s=n(r(52)),u=n(r(61)),c=n(r(62)),f=n(r(63)),l=n(r(57)),p=n(r(58)),h=r(32),m=o("unequal",{"any, any":function(e,t){return null===e?null!==t:null===t?null!==e:void 0===e?void 0!==t:void 0===t?void 0!==e:d(e,t)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=c(e,t,d);break;default:r=u(t,e,d,!0)}break;default:switch(t.storage()){case"sparse":r=u(e,t,d,!1);break;default:r=l(e,t,d)}}return r},"Array, Array":function(e,t){return m(s(e),s(t)).valueOf()},"Array, Matrix":function(e,t){return m(s(e),t)},"Matrix, Array":function(e,t){return m(e,s(t))},"Matrix, any":function(e,t){var r;switch(e.storage()){case"sparse":r=f(e,t,d,!1);break;default:r=p(e,t,d,!1)}return r},"any, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,d,!0);break;default:r=p(t,e,d,!0)}return r},"Array, any":function(e,t){return p(s(e),t,d,!1).valueOf()},"any, Array":function(e,t){return p(s(t),e,d,!0).valueOf()}}),d=o("_unequal",{"boolean, boolean":function(e,t){return e!==t},"number, number":function(e,r){return!i(e,r,t.epsilon)},"BigNumber, BigNumber":function(e,r){return!a(e,r,t.epsilon)},"Fraction, Fraction":function(e,t){return!e.equals(t)},"Complex, Complex":function(e,t){return!e.equals(t)},"Unit, Unit":function(e,t){if(!e.equalBase(t))throw new Error("Cannot compare units with different base");return m(e.value,t.value)},"string, string":function(e,t){return e!==t}});return m.toTex={2:"\\left(${args[0]}"+h.operators.unequal+"${args[1]}\\right)"},m}var i=r(6).nearlyEqual,a=r(49);t.name="unequal",t.factory=n},function(e,t,r){e.exports=[r(311),r(316),r(451),r(321),r(452),r(453),r(454),r(455),r(439),r(456)]},function(e,t,r){"use strict";function n(e,t,n,o){function s(e){e=i(e.valueOf());var t=e.length;if(0==t)throw new Error("Cannot calculate median of an empty array");if(t%2==0){for(var r=t/2-1,n=l(e,r+1),a=e[r],o=0;r>o;++o)f(e[o],a)>0&&(a=e[o]);return m(a,n)}var s=l(e,(t-1)/2);return h(s)}var u=n(r(53)),c=n(r(81)),f=n(r(432)),l=n(r(431)),p=o("median",{"Array | Matrix":s,"Array | Matrix, number | BigNumber":function(e,t){throw new Error("median(A, dim) is not yet supported")},"...":function(e){if(a(e))throw new TypeError("Scalar values expected in function median");return s(e)}}),h=o({"number | BigNumber | Unit":function(e){return e}}),m=o({"number | BigNumber | Unit, number | BigNumber | Unit":function(e,t){return c(u(e,t),2)}});return p.toTex=void 0,p}var i=r(40).flatten,a=(r(313),r(314));t.name="median",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){function a(e){e=i(e.valueOf());var t=e.length;if(0==t)throw new Error("Cannot calculate mode of an empty array");var r={},n=[],a=0;for(var o in e)e[o]in r||(r[e[o]]=0),r[e[o]]++,r[e[o]]==a?n.push(e[o]):r[e[o]]>a&&(a=r[e[o]],n=[e[o]]);return n}var o=n("mode",{"Array | Matrix":a,"...":function(e){return a(e)}});return o}var i=r(40).flatten;t.name="mode",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){function o(e){var t=void 0;if(i(e,function(e){t=void 0===t?e:s(t,e)}),void 0===t)throw new Error("Cannot calculate prod of an empty array");return t}var s=n(r(80)),u=a("prod",{"Array | Matrix":o,"Array | Matrix, number | BigNumber":function(e,t){throw new Error("prod(A, dim) is not yet supported")},"...":function(e){return o(e)}});return u.toTex=void 0,u}var i=r(312);t.name="prod",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,u){function c(t,r,n){var o,u,c;if(arguments.length<2||arguments.length>3)throw new SyntaxError("Function quantileSeq requires two or three parameters");if(s(t)){if(n=n||!1,"boolean"==typeof n){if(u=t.valueOf(),a(r)){if(0>r)throw new Error("N/prob must be non-negative");if(1>=r)return f(u,r,n);if(r>1){if(!i(r))throw new Error("N must be a positive integer");var l=r+1;o=new Array(r);for(var p=0;r>p;)o[p]=f(u,++p/l,n);return o}}if(r&&r.isBigNumber){if(r.isNegative())throw new Error("N/prob must be non-negative");if(c=new r.constructor(1),r.lte(c))return f(u,r,n);if(r.gt(c)){if(!r.isInteger())throw new Error("N must be a positive integer");var h=r.toNumber();if(h>4294967295)throw new Error("N must be less than or equal to 2^32-1, as that is the maximum length of an Array");var l=new e.BigNumber(h+1);o=new Array(h);for(var p=0;h>p;)o[p]=f(u,new e.BigNumber(++p).div(l),n);return o}}if(Array.isArray(r)){o=new Array(r.length);for(var p=0;p<o.length;++p){var m=r[p];if(a(m)){if(0>m||m>1)throw new Error("Probability must be between 0 and 1, inclusive")}else{if(!m||!m.isBigNumber)throw new TypeError("Unexpected type of argument in function quantileSeq");if(c=new m.constructor(1),m.isNegative()||m.gt(c))throw new Error("Probability must be between 0 and 1, inclusive")}o[p]=f(u,m,n)}return o}throw new TypeError("Unexpected type of argument in function quantileSeq")}throw new TypeError("Unexpected type of argument in function quantileSeq")}throw new TypeError("Unexpected type of argument in function quantileSeq")}function f(e,t,r){var n=o(e),i=n.length;if(0===i)throw new Error("Cannot calculate quantile of an empty sequence");if(a(t)){var s=t*(i-1),u=s%1;if(0===u){var c=r?n[s]:h(n,s);return d(c),c}var f,g,v=Math.floor(s);if(r)f=n[v],g=n[v+1];else{g=h(n,v+1),f=n[v];for(var y=0;v>y;++y)m(n[y],f)>0&&(f=n[y])}return d(f),d(g),l(p(f,1-u),p(g,u))}var s=t.times(i-1);if(s.isInteger()){s=s.toNumber();var c=r?n[s]:h(n,s);return d(c),c}var f,g,v=s.floor(),u=s.minus(v),x=v.toNumber();if(r)f=n[x],g=n[x+1];else{g=h(n,x+1),f=n[x];for(var y=0;x>y;++y)m(n[y],f)>0&&(f=n[y])}d(f),d(g);var b=new u.constructor(1);return l(p(f,b.minus(u)),p(g,u))}var l=n(r(51)),p=n(r(84)),h=n(r(431)),m=n(r(432)),d=u({"number | BigNumber | Unit":function(e){return e}});return c}var i=r(6).isInteger,a=r(6).isNumber,o=r(40).flatten,s=r(310);t.name="quantileSeq",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){function a(e,t){if(0==e.length)throw new SyntaxError("Function std requires one or more parameters (0 provided)");return o(s.apply(null,arguments))}var o=n(r(369)),s=n(r(456)),u=i("std",{"Array | Matrix":a,"Array | Matrix, string":a,"...":function(e){return a(e)}});return u.toTex=void 0,u}t.name="std",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,o){function s(t,r){var n=0,i=0;if(0==t.length)throw new SyntaxError("Function var requires one or more parameters (0 provided)");if(a(t,function(e){n=u(n,e),i++}),0===i)throw new Error("Cannot calculate var of an empty array");var o=l(n,i);switch(n=0,a(t,function(e){var t=c(e,o);n=u(n,f(t,t))}),r){case"uncorrected":return l(n,i);case"biased":return l(n,i+1);case"unbiased":var s=n&&n.isBigNumber===!0?new e.BigNumber(0):0;return 1==i?s:l(n,i-1);default:throw new Error('Unknown normalization "'+r+'". Choose "unbiased" (default), "uncorrected", or "biased".')}}var u=n(r(53)),c=n(r(77)),f=n(r(80)),l=n(r(81)),p=o("variance",{"Array | Matrix":function(e){return s(e,i)},"Array | Matrix, string":s,"...":function(e){return s(e,i)}});return p.toTex="\\mathrm{Var}\\left(${args}\\right)",p}var i="unbiased",a=r(312);t.name="var",t.factory=n},function(e,t,r){e.exports=[r(89),r(458)]},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("print",{"string, Object":i,"string, Object, number":i});return a.toTex=void 0,a}function i(e,t,r){return e.replace(/\$([\w\.]+)/g,function(e,n){for(var i=n.split("."),s=t[i.shift()];i.length&&void 0!==s;){var u=i.shift();s=u?s[u]:s+"."}return void 0!==s?a(s)?s:o(s,r):e})}var a=r(23).isString,o=r(23).format;t.name="print",t.factory=n},function(e,t,r){e.exports=[r(460),r(461),r(462),r(463),r(464),r(465),r(466),r(467),r(468),r(469),r(470),r(471),r(472),r(473),r(474),r(475),r(476),r(477),r(478),r(479),r(480),r(481),r(482),r(483),r(484)]},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("acos",{number:function(r){return r>=-1&&1>=r||t.predictable?Math.acos(r):new e.Complex(r,0).acos()},Complex:function(e){return e.acos()},BigNumber:function(e){return e.acos()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\cos^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="acos",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("acosh",{number:function(r){return r>=1||t.predictable?a(r):-1>=r?new e.Complex(Math.log(Math.sqrt(r*r-1)-r),Math.PI):new e.Complex(r,0).acosh()},Complex:function(e){return e.acosh()},BigNumber:function(e){return e.acosh()},"Array | Matrix":function(e){return i(e,o)}});return o.toTex={1:"\\cosh^{-1}\\left(${args[0]}\\right)"},o}var i=r(19),a=Math.acosh||function(e){return Math.log(Math.sqrt(e*e-1)+e)};t.name="acosh",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("acot",{number:function(e){return Math.atan(1/e)},Complex:function(e){return e.acot()},BigNumber:function(t){return new e.BigNumber(1).div(t).atan()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\cot^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="acot",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("acoth",{number:function(r){return r>=1||-1>=r||t.predictable?isFinite(r)?(Math.log((r+1)/r)+Math.log(r/(r-1)))/2:0:new e.Complex(r,0).acoth()},Complex:function(e){return e.acoth()},BigNumber:function(t){return new e.BigNumber(1).div(t).atanh()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\coth^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="acoth",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("acsc",{number:function(r){return-1>=r||r>=1||t.predictable?Math.asin(1/r):new e.Complex(r,0).acsc()},Complex:function(e){return e.acsc()},BigNumber:function(t){return new e.BigNumber(1).div(t).asin()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\csc^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="acsc",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("acsch",{number:function(e){return e=1/e,Math.log(e+Math.sqrt(e*e+1))},Complex:function(e){return e.acsch()},BigNumber:function(t){return new e.BigNumber(1).div(t).asinh()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\mathrm{csch}^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="acsch",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("asec",{number:function(r){return-1>=r||r>=1||t.predictable?Math.acos(1/r):new e.Complex(r,0).asec()},Complex:function(e){return e.asec()},BigNumber:function(t){return new e.BigNumber(1).div(t).acos()},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\sec^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="asec",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,a){var o=(a.find(n(r(461)),["Complex"]),a("asech",{number:function(r){if(1>=r&&r>=-1||t.predictable){r=1/r;var n=Math.sqrt(r*r-1);return r>0||t.predictable?Math.log(n+r):new e.Complex(Math.log(n-r),Math.PI)}return new e.Complex(r,0).asech()},Complex:function(e){return e.asech()},BigNumber:function(t){return new e.BigNumber(1).div(t).acosh()},"Array | Matrix":function(e){return i(e,o)}}));return o.toTex={1:"\\mathrm{sech}^{-1}\\left(${args[0]}\\right)"},o}var i=r(19);t.name="asech",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("asin",{number:function(r){return r>=-1&&1>=r||t.predictable?Math.asin(r):new e.Complex(r,0).asin()},Complex:function(e){return e.asin()},BigNumber:function(e){return e.asin()},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\sin^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="asin",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("asinh",{number:Math.asinh||function(e){return Math.log(Math.sqrt(e*e+1)+e)},Complex:function(e){return e.asinh()},BigNumber:function(e){return e.asinh()},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\sinh^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="asinh",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("atan",{number:function(e){return Math.atan(e)},Complex:function(e){return e.atan()},BigNumber:function(e){return e.atan()},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\tan^{-1}\\left(${args[0]}\\right)"},a}var i=r(19);t.name="atan",t.factory=n},function(e,t,r){"use strict";function n(e,t,n,i){var a=n(r(52)),o=n(r(360)),s=n(r(61)),u=n(r(362)),c=n(r(85)),f=n(r(63)),l=n(r(57)),p=n(r(58)),h=i("atan2",{"number, number":Math.atan2,"BigNumber, BigNumber":function(t,r){return e.BigNumber.atan2(t,r)},"Matrix, Matrix":function(e,t){var r;switch(e.storage()){case"sparse":switch(t.storage()){case"sparse":r=u(e,t,h,!1);break;default:r=o(t,e,h,!0)}break;default:switch(t.storage()){case"sparse":r=s(e,t,h,!1);break;default:r=l(e,t,h)}}return r},"Array, Array":function(e,t){return h(a(e),a(t)).valueOf()},"Array, Matrix":function(e,t){return h(a(e),t)},"Matrix, Array":function(e,t){return h(e,a(t))},"Matrix, number | BigNumber":function(e,t){var r;switch(e.storage()){case"sparse":r=c(e,t,h,!1);break;default:r=p(e,t,h,!1)}return r},"number | BigNumber, Matrix":function(e,t){var r;switch(t.storage()){case"sparse":r=f(t,e,h,!0);break;default:r=p(t,e,h,!0)}return r},"Array, number | BigNumber":function(e,t){return p(a(e),t,h,!1).valueOf()},"number | BigNumber, Array":function(e,t){return p(a(t),e,h,!0).valueOf()}});return h.toTex={2:"\\mathrm{atan2}\\left(${args}\\right)"},h}t.name="atan2",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("atanh",{number:function(r){return 1>=r&&r>=-1||t.predictable?a(r):new e.Complex(r,0).atanh()},Complex:function(e){return e.atanh()},BigNumber:function(e){return e.atanh()},"Array | Matrix":function(e){return i(e,o,!0)}});return o.toTex={1:"\\tanh^{-1}\\left(${args[0]}\\right)"},o}var i=r(19),a=Math.atanh||function(e){return Math.log((1+e)/(1-e))/2};t.name="atanh",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("cos",{number:Math.cos,Complex:function(e){return e.cos()},BigNumber:function(e){return e.cos()},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function cos is no angle");return a(t.value)},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\cos\\left(${args[0]}\\right)"},a}var i=r(19);t.name="cos",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("cosh",{number:a,Complex:function(e){return e.cosh()},BigNumber:function(e){return e.cosh()},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function cosh is no angle");return o(t.value)},"Array | Matrix":function(e){return i(e,o)}});return o.toTex={1:"\\cosh\\left(${args[0]}\\right)"},o}var i=r(19),a=Math.cosh||function(e){return(Math.exp(e)+Math.exp(-e))/2};t.name="cosh",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("cot",{number:function(e){return 1/Math.tan(e)},Complex:function(e){return e.cot()},BigNumber:function(t){return new e.BigNumber(1).div(t.tan())},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function cot is no angle");return a(t.value)},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\cot\\left(${args[0]}\\right)"},a}var i=r(19);t.name="cot",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("coth",{number:i,Complex:function(e){return e.coth()},BigNumber:function(t){return new e.BigNumber(1).div(t.tanh())},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function coth is no angle");return o(t.value)},"Array | Matrix":function(e){return a(e,o)}});return o.toTex={1:"\\coth\\left(${args[0]}\\right)"},o}function i(e){var t=Math.exp(2*e);return(t+1)/(t-1)}var a=r(19);t.name="coth",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("csc",{number:function(e){return 1/Math.sin(e)},Complex:function(e){return e.csc()},BigNumber:function(t){return new e.BigNumber(1).div(t.sin())},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function csc is no angle");return a(t.value)},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\csc\\left(${args[0]}\\right)"},a}var i=r(19);t.name="csc",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("csch",{number:i,Complex:function(e){return e.csch()},BigNumber:function(t){return new e.BigNumber(1).div(t.sinh())},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function csch is no angle");return o(t.value)},"Array | Matrix":function(e){return a(e,o)}});return o.toTex={1:"\\mathrm{csch}\\left(${args[0]}\\right)"},o}function i(e){return 0==e?Number.POSITIVE_INFINITY:Math.abs(2/(Math.exp(e)-Math.exp(-e)))*o(e)}var a=r(19),o=r(6).sign;t.name="csch",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("sec",{number:function(e){return 1/Math.cos(e)},Complex:function(e){return e.sec()},BigNumber:function(t){return new e.BigNumber(1).div(t.cos())},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function sec is no angle");return a(t.value)},"Array | Matrix":function(e){return i(e,a)}});return a.toTex={1:"\\sec\\left(${args[0]}\\right)"},a}var i=r(19);t.name="sec",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("sech",{number:i,Complex:function(e){return e.sech()},BigNumber:function(t){return new e.BigNumber(1).div(t.cosh())},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function sech is no angle");return o(t.value)},"Array | Matrix":function(e){return a(e,o)}});return o.toTex={1:"\\mathrm{sech}\\left(${args[0]}\\right)"},o}function i(e){return 2/(Math.exp(e)+Math.exp(-e))}var a=r(19);t.name="sech",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("sin",{number:Math.sin,Complex:function(e){return e.sin()},BigNumber:function(e){return e.sin()},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function sin is no angle");return a(t.value)},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\sin\\left(${args[0]}\\right)"},a}var i=r(19);t.name="sin",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("sinh",{number:a,Complex:function(e){return e.sinh()},BigNumber:function(e){return e.sinh()},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function sinh is no angle");return o(t.value)},"Array | Matrix":function(e){return i(e,o,!0)}});return o.toTex={1:"\\sinh\\left(${args[0]}\\right)"},o}var i=r(19),a=Math.sinh||function(e){return(Math.exp(e)-Math.exp(-e))/2};t.name="sinh",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("tan",{number:Math.tan,Complex:function(e){return e.tan()},BigNumber:function(e){return e.tan()},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function tan is no angle");return a(t.value)},"Array | Matrix":function(e){return i(e,a,!0)}});return a.toTex={1:"\\tan\\left(${args[0]}\\right)"},a}var i=r(19);t.name="tan",t.factory=n},function(e,t,r){"use strict";function n(e,t,r,n){var o=n("tanh",{number:a,Complex:function(e){return e.tanh()},BigNumber:function(e){return e.tanh()},Unit:function(t){if(!t.hasBase(e.Unit.BASE_UNITS.ANGLE))throw new TypeError("Unit in function tanh is no angle");return o(t.value)},"Array | Matrix":function(e){return i(e,o,!0)}});return o.toTex={1:"\\tanh\\left(${args[0]}\\right)"},o}var i=r(19),a=Math.tanh||function(e){var t=Math.exp(2*e);return(t-1)/(t+1)};t.name="tanh",t.factory=n},function(e,t,r){e.exports=[r(486)]},function(e,t,r){"use strict";function n(e,t,n,i){var a=r(32),o=n(r(52)),s=n(r(57)),u=n(r(58)),c=i("to",{"Unit, Unit | string":function(e,t){return e.to(t)},"Matrix, Matrix":function(e,t){return s(e,t,c)},"Array, Array":function(e,t){return c(o(e),o(t)).valueOf();
},"Array, Matrix":function(e,t){return c(o(e),t)},"Matrix, Array":function(e,t){return c(e,o(t))},"Matrix, any":function(e,t){return u(e,t,c,!1)},"any, Matrix":function(e,t){return u(t,e,c,!0)},"Array, any":function(e,t){return u(o(e),t,c,!1).valueOf()},"any, Array":function(e,t){return u(o(t),e,c,!0).valueOf()}});return c.toTex={2:"\\left(${args[0]}"+a.operators.to+"${args[1]}\\right)"},c}t.name="to",t.factory=n},function(e,t,r){e.exports=[r(488),r(408),r(356),r(88),r(370),r(422),r(90)]},function(e,t,r){"use strict";function n(e,t,r,n){var a=n("clone",{any:i.clone});return a.toTex=void 0,a}var i=r(3);t.name="clone",t.factory=n},function(e,t,r){e.exports=[r(490)]},function(e,t){"use strict";function r(e,t,r,n){return function(t,r){var n=e[r&&r.mathjs];return n&&"function"==typeof n.fromJSON?n.fromJSON(r):r}}t.name="reviver",t.path="json",t.factory=r},function(e,t,r){"use strict";var n=r(11),i=r(42),a=r(43);e.exports=[{name:"ArgumentsError",path:"error",factory:function(){return n}},{name:"DimensionError",path:"error",factory:function(){return i}},{name:"IndexError",path:"error",factory:function(){return a}}]}])});
//# sourceMappingURL=math.map;
define('calculator/utils',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    exports.objectEntries = objectEntries;
    exports.findSmallestButGreaterThan = findSmallestButGreaterThan;

    var _marked = [objectEntries].map(regeneratorRuntime.mark);

    function objectEntries(obj) {
        var _iteratorNormalCompletion, _didIteratorError, _iteratorError, _iterator, _step, key;

        return regeneratorRuntime.wrap(function objectEntries$(_context) {
            while (1) {
                switch (_context.prev = _context.next) {
                    case 0:
                        _iteratorNormalCompletion = true;
                        _didIteratorError = false;
                        _iteratorError = undefined;
                        _context.prev = 3;
                        _iterator = Object.keys(obj)[Symbol.iterator]();

                    case 5:
                        if (_iteratorNormalCompletion = (_step = _iterator.next()).done) {
                            _context.next = 12;
                            break;
                        }

                        key = _step.value;
                        _context.next = 9;
                        return [key, obj[key]];

                    case 9:
                        _iteratorNormalCompletion = true;
                        _context.next = 5;
                        break;

                    case 12:
                        _context.next = 18;
                        break;

                    case 14:
                        _context.prev = 14;
                        _context.t0 = _context["catch"](3);
                        _didIteratorError = true;
                        _iteratorError = _context.t0;

                    case 18:
                        _context.prev = 18;
                        _context.prev = 19;

                        if (!_iteratorNormalCompletion && _iterator.return) {
                            _iterator.return();
                        }

                    case 21:
                        _context.prev = 21;

                        if (!_didIteratorError) {
                            _context.next = 24;
                            break;
                        }

                        throw _iteratorError;

                    case 24:
                        return _context.finish(21);

                    case 25:
                        return _context.finish(18);

                    case 26:
                    case "end":
                        return _context.stop();
                }
            }
        }, _marked[0], this, [[3, 14, 18, 26], [19,, 21, 25]]);
    }

    function findSmallestButGreaterThan(array, greaterThan) {
        return array.reduce(function (a, b) {
            if (a <= greaterThan) {
                return b < greaterThan ? greaterThan : b;
            }
            if (a > b && b > greaterThan) {
                return b;
            }
            return a;
        });
    }
});
//# sourceMappingURL=utils.js.map
;
define('calculator/token',['exports', 'mathjs', 'calculator/utils'], function (exports, _mathjs, _utils) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    exports.toString = toString;
    exports.evaluateTokens = evaluateTokens;
    exports.getLastOperatorIndex = getLastOperatorIndex;

    var _mathjs2 = _interopRequireDefault(_mathjs);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    var typeToSymbol = {
        'sqrt': '&radic;'
    };

    function toString(tokens, options) {
        options = options || { skipEndOperator: false };
        options.skipEndOperator = options.skipEndOperator === true;

        var s = '';

        for (var t = 0; t < tokens.length; ++t) {
            var str = tokens[t];

            if (t === tokens.length - 1 && options.skipEndOperator && isOperator(str)) {
                continue;
            } else if (isOperator(str)) {
                str = ' ' + str + ' ';
            }

            if (str.type) {
                var symbol = typeToSymbol[str.type] || str.type;
                str = symbol + '(' + toString(str.tokens) + ')';
            }

            s += str;
        }

        return s;
    }

    function evaluateTokens(tokens) {
        var nextOperatorIndex = getNextOperatorIndex(tokens, 0);
        var chain = void 0;

        if (nextOperatorIndex === -1) {
            if (tokens[tokens.length - 1].type) {
                chain = _mathjs2.default.chain(evaluateTokens(tokens[tokens.length - 1].tokens))[getMethodName(tokens[tokens.length - 1])]();
            } else {
                chain = _mathjs2.default.chain(tokens.slice(0, tokens.length).join(''));
            }
        } else {
            if (tokens[nextOperatorIndex - 1].type) {
                chain = _mathjs2.default.chain(evaluateTokens(tokens[nextOperatorIndex - 1].tokens))[getMethodName(tokens[nextOperatorIndex - 1])]();
            } else {
                chain = _mathjs2.default.chain(tokens.slice(0, nextOperatorIndex).join(''));
            }
        }

        for (var i = nextOperatorIndex; i < tokens.length && nextOperatorIndex !== -1;) {
            var methodName = getMethodName(tokens[i]);
            var hasType = !!tokens[i].type;
            var methodTokens = tokens[i].tokens;
            i++;

            nextOperatorIndex = getNextOperatorIndex(tokens, i);

            if (nextOperatorIndex === -1) {
                nextOperatorIndex = tokens.length;
            }
            if (i === tokens.length) {
                continue;
            }

            if (hasType) {
                chain = chain[methodName](methodTokens.join(''));
            } else {
                chain = chain[methodName](evaluateTokens(tokens.slice(i, nextOperatorIndex)));
            }

            i = nextOperatorIndex;
        }

        return chain.done();
    }

    function getLastOperatorIndex(tokens) {
        var operatorIndex = -1;
        operatorIndex = Math.max(tokens.lastIndexOf('+'), operatorIndex);
        operatorIndex = Math.max(tokens.lastIndexOf('-'), operatorIndex);
        operatorIndex = Math.max(tokens.lastIndexOf('&times;'), operatorIndex);
        operatorIndex = Math.max(tokens.lastIndexOf('&divide;'), operatorIndex);

        return operatorIndex;
    }

    function isOperator(token) {
        return token === '+' || token === '-' || token === '&times;' || token === '&divide;';
    }

    function getMethodName(token) {
        switch (token.type) {
            case 'sqrt':
                return 'sqrt';
            case 'square':
                return 'square';
        }

        switch (token) {
            case '+':
                return 'add';
            case '-':
                return 'subtract';
            case '&times;':
                return 'multiply';
            case '&divide;':
                return 'divide';
        }
    }

    function getNextOperatorIndex(tokens, start) {
        return (0, _utils.findSmallestButGreaterThan)([tokens.indexOf('+', start), tokens.indexOf('-', start), tokens.indexOf('&times;', start), tokens.indexOf('&divide;', start)], -1);
    }
});
//# sourceMappingURL=token.js.map
;
define('calculator/lib/calculations/Backspace',['exports', 'calculator/token', 'calculator/constant/TokenManagerEvents', 'calculator/constant/TokenManagerStates'], function (exports, _token, _TokenManagerEvents, _TokenManagerStates) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerEvents2 = _interopRequireDefault(_TokenManagerEvents);

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (tokenManager, button) {
        var lastOperatorIndex = (0, _token.getLastOperatorIndex)(tokenManager.tokens);
        if (lastOperatorIndex === tokenManager.tokens.length - 1) {
            return;
        }

        tokenManager.tokens.splice(-1);

        if (lastOperatorIndex === tokenManager.tokens.length - 1 || !tokenManager.tokens.length) {
            tokenManager.tokens.push('0');
        }

        if (tokenManager.state === _TokenManagerStates2.default.EVALUATED) {
            return;
        }

        tokenManager.trigger(_TokenManagerEvents2.default.CHANGE);
    };
});
//# sourceMappingURL=Backspace.js.map
;
define('calculator/lib/calculations/Percent',['exports', 'calculator/token', 'calculator/constant/TokenManagerEvents'], function (exports, _token, _TokenManagerEvents) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerEvents2 = _interopRequireDefault(_TokenManagerEvents);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (tokenManager, button) {

        var lastOperatorIndex = (0, _token.getLastOperatorIndex)(tokenManager.tokens);
        if (lastOperatorIndex === -1) {
            tokenManager.clear();
            tokenManager.trigger(_TokenManagerEvents2.default.CUSTOM, '0', '0');
            return;
        }

        var evaluatedTokens = (0, _token.evaluateTokens)(tokenManager.tokens.slice(0, lastOperatorIndex));
        var originalLastValue = tokenManager.tokens.slice(lastOperatorIndex + 1)[0];
        var lastValue = originalLastValue;

        if (lastValue === undefined) {
            lastValue = evaluatedTokens;
        }

        var value = (parseFloat(lastValue) / 100 * parseFloat(evaluatedTokens)).toString();
        tokenManager.push(value, { replace: originalLastValue !== undefined });

        tokenManager.trigger(_TokenManagerEvents2.default.CUSTOM, (0, _token.toString)(tokenManager.tokens), value);
    };
});
//# sourceMappingURL=Percent.js.map
;
define('calculator/lib/calculations/Sqrt',['exports', 'calculator/token', 'calculator/constant/TokenManagerEvents', 'calculator/constant/TokenManagerStates'], function (exports, _token, _TokenManagerEvents, _TokenManagerStates) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerEvents2 = _interopRequireDefault(_TokenManagerEvents);

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (tokenManager, button) {
        var answerStr = tokenManager.answerStr;

        tokenManager.push({
            type: 'sqrt',
            tokens: [answerStr]
        }, { replace: true });

        if (parseFloat(answerStr) < 0) {
            tokenManager.setToInvalid();
        }

        tokenManager.trigger(_TokenManagerEvents2.default.EVALUATION);
    };
});
//# sourceMappingURL=Sqrt.js.map
;
define('calculator/lib/calculations/Square',['exports', 'calculator/token', 'calculator/constant/TokenManagerEvents', 'calculator/constant/TokenManagerStates'], function (exports, _token, _TokenManagerEvents, _TokenManagerStates) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerEvents2 = _interopRequireDefault(_TokenManagerEvents);

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (tokenManager, button) {
        tokenManager.push({
            type: 'square',
            tokens: tokenManager.tokens.slice()
        }, { replace: true });

        tokenManager.trigger(_TokenManagerEvents2.default.EVALUATION);
    };
});
//# sourceMappingURL=Square.js.map
;
define('calculator/config/calculations',['exports', '../lib/calculations/AddNumberToken', '../lib/calculations/AddArithmeticToken', '../lib/calculations/Evaluate', '../lib/calculations/ClearTokens', '../lib/calculations/ClearLastTokens', '../lib/calculations/Backspace', '../lib/calculations/Percent', '../lib/calculations/Sqrt', '../lib/calculations/Square'], function (exports, _AddNumberToken, _AddArithmeticToken, _Evaluate, _ClearTokens, _ClearLastTokens, _Backspace, _Percent, _Sqrt, _Square) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _AddNumberToken2 = _interopRequireDefault(_AddNumberToken);

    var _AddArithmeticToken2 = _interopRequireDefault(_AddArithmeticToken);

    var _Evaluate2 = _interopRequireDefault(_Evaluate);

    var _ClearTokens2 = _interopRequireDefault(_ClearTokens);

    var _ClearLastTokens2 = _interopRequireDefault(_ClearLastTokens);

    var _Backspace2 = _interopRequireDefault(_Backspace);

    var _Percent2 = _interopRequireDefault(_Percent);

    var _Sqrt2 = _interopRequireDefault(_Sqrt);

    var _Square2 = _interopRequireDefault(_Square);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = {
        'AddNumberToken': _AddNumberToken2.default,
        'AddArithmeticToken': _AddArithmeticToken2.default,
        'Evaluate': _Evaluate2.default,
        'ClearTokens': _ClearTokens2.default,
        'ClearLastTokens': _ClearLastTokens2.default,
        'Backspace': _Backspace2.default,
        'Percent': _Percent2.default,
        'Sqrt': _Sqrt2.default,
        'Square': _Square2.default
    };
});
//# sourceMappingURL=calculations.js.map
;
define('calculator/lib/behaviours/Referencable',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var _class = function () {
        function _class() {
            _classCallCheck(this, _class);
        }

        _createClass(_class, [{
            key: 'getReference',
            value: function getReference(referenceString) {
                if (referenceString[0] !== '&') {
                    return;
                }

                var name = referenceString.substr(1);
                if (this['$' + name]) {
                    return this['$' + name];
                }
                return this[name];
            }
        }]);

        return _class;
    }();

    exports.default = _class;
});
//# sourceMappingURL=Referencable.js.map
;
define('calculator/lib/behaviours/Resizer',['exports', 'jquery'], function (exports, _jquery) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var _class = function () {
        function _class(layout) {
            _classCallCheck(this, _class);

            this.layout = layout;
        }

        _createClass(_class, [{
            key: 'start',
            value: function start() {
                (0, _jquery2.default)(window).on('resize', resize.bind(this));
                resize.call(this);
            }
        }]);

        return _class;
    }();

    exports.default = _class;


    function resize() {
        var remainingHeight = window.innerHeight - this.layout.$output.height() - this.layout.$toolbar.height();
        var $rows = this.layout.$el.find('.row');
        var rowHeight = remainingHeight / $rows.length;

        $rows.css('height', rowHeight + 'px');

        var panelHeight = remainingHeight - rowHeight;

        this.layout.history.$innerPanel.css({ height: panelHeight + 'px' });
        this.layout.memoryStack.$innerPanel.css({ height: panelHeight + 'px' });
    }
});
//# sourceMappingURL=Resizer.js.map
;
define('calculator/constant/Panel',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    var Panel = {};

    Object.defineProperties(Panel, {
        CLOSE_EVENT: { value: 'closePanel' }
    });

    exports.default = Panel;
});
//# sourceMappingURL=Panel.js.map
;
define('calculator/lib/builder/Panel',['exports', 'jquery', 'calculator/constant/Panel'], function (exports, _jquery, _Panel) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    var _Panel2 = _interopRequireDefault(_Panel);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _class = function _class(options) {
        var _this = this;

        _classCallCheck(this, _class);

        options = options || {};

        this.$el = (0, _jquery2.default)('<div class=\'panel ' + options.className + ' displayNone\'></div>');
        this.$innerPanel = (0, _jquery2.default)('<div class="innerPanel"></div>');

        this.$el.append(this.$innerPanel);
        this.$el.on(_Panel2.default.CLOSE_EVENT, function () {
            _this.$el.addClass('displayNone');
        });

        this.$el.click(function () {
            _this.$el.trigger(_Panel2.default.CLOSE_EVENT);
        });

        this.$innerPanel.click(function (e) {
            e.stopImmediatePropagation();
        });
    };

    exports.default = _class;
});
//# sourceMappingURL=Panel.js.map
;
/**
 * @license text 2.0.15 Copyright jQuery Foundation and other contributors.
 * Released under MIT license, http://github.com/requirejs/text/LICENSE
 */
/*jslint regexp: true */
/*global require, XMLHttpRequest, ActiveXObject,
  define, window, process, Packages,
  java, location, Components, FileUtils */

define('text',['module'], function (module) {
    'use strict';

    var text, fs, Cc, Ci, xpcIsWindows,
        progIds = ['Msxml2.XMLHTTP', 'Microsoft.XMLHTTP', 'Msxml2.XMLHTTP.4.0'],
        xmlRegExp = /^\s*<\?xml(\s)+version=[\'\"](\d)*.(\d)*[\'\"](\s)*\?>/im,
        bodyRegExp = /<body[^>]*>\s*([\s\S]+)\s*<\/body>/im,
        hasLocation = typeof location !== 'undefined' && location.href,
        defaultProtocol = hasLocation && location.protocol && location.protocol.replace(/\:/, ''),
        defaultHostName = hasLocation && location.hostname,
        defaultPort = hasLocation && (location.port || undefined),
        buildMap = {},
        masterConfig = (module.config && module.config()) || {};

    function useDefault(value, defaultValue) {
        return value === undefined || value === '' ? defaultValue : value;
    }

    //Allow for default ports for http and https.
    function isSamePort(protocol1, port1, protocol2, port2) {
        if (port1 === port2) {
            return true;
        } else if (protocol1 === protocol2) {
            if (protocol1 === 'http') {
                return useDefault(port1, '80') === useDefault(port2, '80');
            } else if (protocol1 === 'https') {
                return useDefault(port1, '443') === useDefault(port2, '443');
            }
        }
        return false;
    }

    text = {
        version: '2.0.15',

        strip: function (content) {
            //Strips <?xml ...?> declarations so that external SVG and XML
            //documents can be added to a document without worry. Also, if the string
            //is an HTML document, only the part inside the body tag is returned.
            if (content) {
                content = content.replace(xmlRegExp, "");
                var matches = content.match(bodyRegExp);
                if (matches) {
                    content = matches[1];
                }
            } else {
                content = "";
            }
            return content;
        },

        jsEscape: function (content) {
            return content.replace(/(['\\])/g, '\\$1')
                .replace(/[\f]/g, "\\f")
                .replace(/[\b]/g, "\\b")
                .replace(/[\n]/g, "\\n")
                .replace(/[\t]/g, "\\t")
                .replace(/[\r]/g, "\\r")
                .replace(/[\u2028]/g, "\\u2028")
                .replace(/[\u2029]/g, "\\u2029");
        },

        createXhr: masterConfig.createXhr || function () {
            //Would love to dump the ActiveX crap in here. Need IE 6 to die first.
            var xhr, i, progId;
            if (typeof XMLHttpRequest !== "undefined") {
                return new XMLHttpRequest();
            } else if (typeof ActiveXObject !== "undefined") {
                for (i = 0; i < 3; i += 1) {
                    progId = progIds[i];
                    try {
                        xhr = new ActiveXObject(progId);
                    } catch (e) {}

                    if (xhr) {
                        progIds = [progId];  // so faster next time
                        break;
                    }
                }
            }

            return xhr;
        },

        /**
         * Parses a resource name into its component parts. Resource names
         * look like: module/name.ext!strip, where the !strip part is
         * optional.
         * @param {String} name the resource name
         * @returns {Object} with properties "moduleName", "ext" and "strip"
         * where strip is a boolean.
         */
        parseName: function (name) {
            var modName, ext, temp,
                strip = false,
                index = name.lastIndexOf("."),
                isRelative = name.indexOf('./') === 0 ||
                             name.indexOf('../') === 0;

            if (index !== -1 && (!isRelative || index > 1)) {
                modName = name.substring(0, index);
                ext = name.substring(index + 1);
            } else {
                modName = name;
            }

            temp = ext || modName;
            index = temp.indexOf("!");
            if (index !== -1) {
                //Pull off the strip arg.
                strip = temp.substring(index + 1) === "strip";
                temp = temp.substring(0, index);
                if (ext) {
                    ext = temp;
                } else {
                    modName = temp;
                }
            }

            return {
                moduleName: modName,
                ext: ext,
                strip: strip
            };
        },

        xdRegExp: /^((\w+)\:)?\/\/([^\/\\]+)/,

        /**
         * Is an URL on another domain. Only works for browser use, returns
         * false in non-browser environments. Only used to know if an
         * optimized .js version of a text resource should be loaded
         * instead.
         * @param {String} url
         * @returns Boolean
         */
        useXhr: function (url, protocol, hostname, port) {
            var uProtocol, uHostName, uPort,
                match = text.xdRegExp.exec(url);
            if (!match) {
                return true;
            }
            uProtocol = match[2];
            uHostName = match[3];

            uHostName = uHostName.split(':');
            uPort = uHostName[1];
            uHostName = uHostName[0];

            return (!uProtocol || uProtocol === protocol) &&
                   (!uHostName || uHostName.toLowerCase() === hostname.toLowerCase()) &&
                   ((!uPort && !uHostName) || isSamePort(uProtocol, uPort, protocol, port));
        },

        finishLoad: function (name, strip, content, onLoad) {
            content = strip ? text.strip(content) : content;
            if (masterConfig.isBuild) {
                buildMap[name] = content;
            }
            onLoad(content);
        },

        load: function (name, req, onLoad, config) {
            //Name has format: some.module.filext!strip
            //The strip part is optional.
            //if strip is present, then that means only get the string contents
            //inside a body tag in an HTML string. For XML/SVG content it means
            //removing the <?xml ...?> declarations so the content can be inserted
            //into the current doc without problems.

            // Do not bother with the work if a build and text will
            // not be inlined.
            if (config && config.isBuild && !config.inlineText) {
                onLoad();
                return;
            }

            masterConfig.isBuild = config && config.isBuild;

            var parsed = text.parseName(name),
                nonStripName = parsed.moduleName +
                    (parsed.ext ? '.' + parsed.ext : ''),
                url = req.toUrl(nonStripName),
                useXhr = (masterConfig.useXhr) ||
                         text.useXhr;

            // Do not load if it is an empty: url
            if (url.indexOf('empty:') === 0) {
                onLoad();
                return;
            }

            //Load the text. Use XHR if possible and in a browser.
            if (!hasLocation || useXhr(url, defaultProtocol, defaultHostName, defaultPort)) {
                text.get(url, function (content) {
                    text.finishLoad(name, parsed.strip, content, onLoad);
                }, function (err) {
                    if (onLoad.error) {
                        onLoad.error(err);
                    }
                });
            } else {
                //Need to fetch the resource across domains. Assume
                //the resource has been optimized into a JS module. Fetch
                //by the module name + extension, but do not include the
                //!strip part to avoid file system issues.
                req([nonStripName], function (content) {
                    text.finishLoad(parsed.moduleName + '.' + parsed.ext,
                                    parsed.strip, content, onLoad);
                });
            }
        },

        write: function (pluginName, moduleName, write, config) {
            if (buildMap.hasOwnProperty(moduleName)) {
                var content = text.jsEscape(buildMap[moduleName]);
                write.asModule(pluginName + "!" + moduleName,
                               "define(function () { return '" +
                                   content +
                               "';});\n");
            }
        },

        writeFile: function (pluginName, moduleName, req, write, config) {
            var parsed = text.parseName(moduleName),
                extPart = parsed.ext ? '.' + parsed.ext : '',
                nonStripName = parsed.moduleName + extPart,
                //Use a '.js' file name so that it indicates it is a
                //script that can be loaded across domains.
                fileName = req.toUrl(parsed.moduleName + extPart) + '.js';

            //Leverage own load() method to load plugin value, but only
            //write out values that do not have the strip argument,
            //to avoid any potential issues with ! in file names.
            text.load(nonStripName, req, function (value) {
                //Use own write() method to construct full module value.
                //But need to create shell that translates writeFile's
                //write() to the right interface.
                var textWrite = function (contents) {
                    return write(fileName, contents);
                };
                textWrite.asModule = function (moduleName, contents) {
                    return write.asModule(moduleName, fileName, contents);
                };

                text.write(pluginName, nonStripName, textWrite, config);
            }, config);
        }
    };

    if (masterConfig.env === 'node' || (!masterConfig.env &&
            typeof process !== "undefined" &&
            process.versions &&
            !!process.versions.node &&
            !process.versions['node-webkit'] &&
            !process.versions['atom-shell'])) {
        //Using special require.nodeRequire, something added by r.js.
        fs = require.nodeRequire('fs');

        text.get = function (url, callback, errback) {
            try {
                var file = fs.readFileSync(url, 'utf8');
                //Remove BOM (Byte Mark Order) from utf8 files if it is there.
                if (file[0] === '\uFEFF') {
                    file = file.substring(1);
                }
                callback(file);
            } catch (e) {
                if (errback) {
                    errback(e);
                }
            }
        };
    } else if (masterConfig.env === 'xhr' || (!masterConfig.env &&
            text.createXhr())) {
        text.get = function (url, callback, errback, headers) {
            var xhr = text.createXhr(), header;
            xhr.open('GET', url, true);

            //Allow plugins direct access to xhr headers
            if (headers) {
                for (header in headers) {
                    if (headers.hasOwnProperty(header)) {
                        xhr.setRequestHeader(header.toLowerCase(), headers[header]);
                    }
                }
            }

            //Allow overrides specified in config
            if (masterConfig.onXhr) {
                masterConfig.onXhr(xhr, url);
            }

            xhr.onreadystatechange = function (evt) {
                var status, err;
                //Do not explicitly handle errors, those should be
                //visible via console output in the browser.
                if (xhr.readyState === 4) {
                    status = xhr.status || 0;
                    if (status > 399 && status < 600) {
                        //An http 4xx or 5xx error. Signal an error.
                        err = new Error(url + ' HTTP status: ' + status);
                        err.xhr = xhr;
                        if (errback) {
                            errback(err);
                        }
                    } else {
                        callback(xhr.responseText);
                    }

                    if (masterConfig.onXhrComplete) {
                        masterConfig.onXhrComplete(xhr, url);
                    }
                }
            };
            xhr.send(null);
        };
    } else if (masterConfig.env === 'rhino' || (!masterConfig.env &&
            typeof Packages !== 'undefined' && typeof java !== 'undefined')) {
        //Why Java, why is this so awkward?
        text.get = function (url, callback) {
            var stringBuffer, line,
                encoding = "utf-8",
                file = new java.io.File(url),
                lineSeparator = java.lang.System.getProperty("line.separator"),
                input = new java.io.BufferedReader(new java.io.InputStreamReader(new java.io.FileInputStream(file), encoding)),
                content = '';
            try {
                stringBuffer = new java.lang.StringBuffer();
                line = input.readLine();

                // Byte Order Mark (BOM) - The Unicode Standard, version 3.0, page 324
                // http://www.unicode.org/faq/utf_bom.html

                // Note that when we use utf-8, the BOM should appear as "EF BB BF", but it doesn't due to this bug in the JDK:
                // http://bugs.sun.com/bugdatabase/view_bug.do?bug_id=4508058
                if (line && line.length() && line.charAt(0) === 0xfeff) {
                    // Eat the BOM, since we've already found the encoding on this file,
                    // and we plan to concatenating this buffer with others; the BOM should
                    // only appear at the top of a file.
                    line = line.substring(1);
                }

                if (line !== null) {
                    stringBuffer.append(line);
                }

                while ((line = input.readLine()) !== null) {
                    stringBuffer.append(lineSeparator);
                    stringBuffer.append(line);
                }
                //Make sure we return a JavaScript string and not a Java string.
                content = String(stringBuffer.toString()); //String
            } finally {
                input.close();
            }
            callback(content);
        };
    } else if (masterConfig.env === 'xpconnect' || (!masterConfig.env &&
            typeof Components !== 'undefined' && Components.classes &&
            Components.interfaces)) {
        //Avert your gaze!
        Cc = Components.classes;
        Ci = Components.interfaces;
        Components.utils['import']('resource://gre/modules/FileUtils.jsm');
        xpcIsWindows = ('@mozilla.org/windows-registry-key;1' in Cc);

        text.get = function (url, callback) {
            var inStream, convertStream, fileObj,
                readData = {};

            if (xpcIsWindows) {
                url = url.replace(/\//g, '\\');
            }

            fileObj = new FileUtils.File(url);

            //XPCOM, you so crazy
            try {
                inStream = Cc['@mozilla.org/network/file-input-stream;1']
                           .createInstance(Ci.nsIFileInputStream);
                inStream.init(fileObj, 1, 0, false);

                convertStream = Cc['@mozilla.org/intl/converter-input-stream;1']
                                .createInstance(Ci.nsIConverterInputStream);
                convertStream.init(inStream, "utf-8", inStream.available(),
                Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

                convertStream.readString(inStream.available(), readData);
                convertStream.close();
                inStream.close();
                callback(readData.value);
            } catch (e) {
                throw new Error((fileObj && fileObj.path || '') + ': ' + e);
            }
        };
    }
    return text;
});


define('text!templates/panel.tpl',[],function () { return '<div class="content">\r\n    <div class="scroll"></div>\r\n    <div class="footer">\r\n        <div class="trash"><a class ="icon icon-bin"></a></div>\r\n    </div>\r\n</div>';});

define('calculator/constant/HistoryManagerEvents',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    var HistoryManagerEvents = {};

    Object.defineProperties(HistoryManagerEvents, {
        CHANGE: { value: 'change' }
    });

    exports.default = HistoryManagerEvents;
});
//# sourceMappingURL=HistoryManagerEvents.js.map
;

define('text!templates/historyState.tpl',[],function () { return '<div class="history-state">\r\n    <div class="top"></div>\r\n    <div class="bottom"></div>\r\n</div>';});

define('calculator/lib/History',['exports', 'jquery', 'calculator/token', 'text!templates/historyState.tpl'], function (exports, _jquery, _token, _historyState) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    var _historyState2 = _interopRequireDefault(_historyState);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _class = function _class(state) {
        _classCallCheck(this, _class);

        this.$el = (0, _jquery2.default)(_historyState2.default);

        build.call(this, state);
    };

    exports.default = _class;

    function build(state) {
        this.$el.find('.top').html((0, _token.toString)(state.tokens, { skipEndOperator: true }) + ' =');
        this.$el.find('.bottom').html(state.answer);
    }
});
//# sourceMappingURL=History.js.map
;
define('calculator/lib/builder/HistoryPanel',['exports', './Panel', 'text!templates/panel.tpl', 'calculator/constant/HistoryManagerEvents', 'calculator/lib/History'], function (exports, _Panel2, _panel, _HistoryManagerEvents, _History) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _Panel3 = _interopRequireDefault(_Panel2);

    var _panel2 = _interopRequireDefault(_panel);

    var _HistoryManagerEvents2 = _interopRequireDefault(_HistoryManagerEvents);

    var _History2 = _interopRequireDefault(_History);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    function _possibleConstructorReturn(self, call) {
        if (!self) {
            throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        }

        return call && (typeof call === "object" || typeof call === "function") ? call : self;
    }

    function _inherits(subClass, superClass) {
        if (typeof superClass !== "function" && superClass !== null) {
            throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
        }

        subClass.prototype = Object.create(superClass && superClass.prototype, {
            constructor: {
                value: subClass,
                enumerable: false,
                writable: true,
                configurable: true
            }
        });
        if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
    }

    var $scroll = Symbol('$scroll');
    var $trash = Symbol('$trash');

    var _class = function (_Panel) {
        _inherits(_class, _Panel);

        function _class(historyManager, options) {
            _classCallCheck(this, _class);

            var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(_class).call(this, options));

            _this.historyManager = historyManager;
            _this.historyManager.on(_HistoryManagerEvents2.default.CHANGE, updateHistory, _this);

            _this.$innerPanel.append(_panel2.default);
            _this[$scroll] = _this.$innerPanel.find('.scroll');
            _this[$trash] = _this.$innerPanel.find('.trash');

            _this[$trash].on('click', _this.historyManager.clear.bind(_this.historyManager));

            buildHistory.call(_this);
            updateTrash.call(_this);
            return _this;
        }

        return _class;
    }(_Panel3.default);

    exports.default = _class;


    function updateHistory() {
        var state = this.historyManager.historyStates[this.historyManager.historyStates.length - 1];

        if (state) {
            addHistory.call(this, state);
        } else {
            this[$scroll].empty();
        }

        updateTrash.call(this);
    }

    function buildHistory() {
        var _this2 = this;

        this.historyManager.historyStates.forEach(function (state) {
            addHistory.call(_this2, state);
        });
    }

    function addHistory(state) {
        var historyView = new _History2.default(state);
        this.historyManager.registerHistory(historyView, state, this.$el);
        this[$scroll].prepend(historyView.$el);
    }

    function updateTrash() {
        var numberOfStates = this.historyManager.historyStates.length;
        this[$trash].toggle(numberOfStates !== 0);
    }
});
//# sourceMappingURL=HistoryPanel.js.map
;
define('calculator/lib/builder/MemoryPanel',['exports', 'jquery', './Panel', 'text!templates/panel.tpl'], function (exports, _jquery, _Panel2, _panel) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    var _Panel3 = _interopRequireDefault(_Panel2);

    var _panel2 = _interopRequireDefault(_panel);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    function _possibleConstructorReturn(self, call) {
        if (!self) {
            throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        }

        return call && (typeof call === "object" || typeof call === "function") ? call : self;
    }

    function _inherits(subClass, superClass) {
        if (typeof superClass !== "function" && superClass !== null) {
            throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
        }

        subClass.prototype = Object.create(superClass && superClass.prototype, {
            constructor: {
                value: subClass,
                enumerable: false,
                writable: true,
                configurable: true
            }
        });
        if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
    }

    var $scroll = Symbol('$scroll');
    var $trash = Symbol('$trash');

    var _class = function (_Panel) {
        _inherits(_class, _Panel);

        function _class(memoryManager, options) {
            _classCallCheck(this, _class);

            var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(_class).call(this, options));

            _this.memoryManager = memoryManager;

            _this.memoryManager.change(updateMemory, _this);

            _this.$innerPanel.append(_panel2.default);
            _this[$scroll] = _this.$innerPanel.find('.scroll');
            _this[$trash] = _this.$innerPanel.find('.trash');

            _this[$trash].on('click', function () {
                _this.memoryManager.clear.call(_this.memoryManager);
            });

            buildMemories.call(_this);
            updateTrash.call(_this);
            return _this;
        }

        return _class;
    }(_Panel3.default);

    exports.default = _class;


    function updateMemory() {
        var stack = this.memoryManager.getMemoryStack();
        var state = stack[stack.length - 1];

        if (state) {
            buildMemory.call(this, state);
        } else {
            this[$scroll].empty();
        }

        updateTrash.call(this);
    }

    function buildMemories() {
        var _this2 = this;

        var stack = this.memoryManager.getMemoryStack();

        stack.forEach(function (value) {
            return buildMemory.call(_this2, value);
        });

        updateTrash.call(this);
    }

    function buildMemory(view) {
        this[$scroll].prepend(view.$el);
    }

    function updateTrash() {
        var numberOfStates = this.memoryManager.getMemoryStack().length;
        this[$trash].toggle(numberOfStates !== 0);
    }
});
//# sourceMappingURL=MemoryPanel.js.map
;
define('calculator/lib/builder/layout',['exports', 'jquery', './Panel', './HistoryPanel', './MemoryPanel'], function (exports, _jquery, _Panel, _HistoryPanel, _MemoryPanel) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (config) {
        this.$el = (0, _jquery2.default)('<div class=\'' + config.name + '\'></div>');

        this.$toolbar = (0, _jquery2.default)('<div class=\'toolbar\'></div>');
        this.$toolbar.append('<div class=\'title\'>' + config.name + '</div>');
        var $toolbarButtons = (0, _jquery2.default)('<div class="buttons"></div>');

        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
            for (var _iterator = config.toolbar.buttons[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                var button = _step.value;

                $toolbarButtons.append(button.$el);
                this.buttons.push(button);
            }
        } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
        } finally {
            try {
                if (!_iteratorNormalCompletion && _iterator.return) {
                    _iterator.return();
                }
            } finally {
                if (_didIteratorError) {
                    throw _iteratorError;
                }
            }
        }

        this.$toolbar.append($toolbarButtons);

        this.$el.append(this.$toolbar);

        this.$output = (0, _jquery2.default)('<div class=\'output\'></div>');
        this.$expressionArea = (0, _jquery2.default)('<div class=\'expressionArea\'></div>');
        this.$answer = (0, _jquery2.default)('<div class=\'answer\'></div>');

        this.$output.append(this.$expressionArea);
        this.$output.append(this.$answer);

        this.$el.append(this.$output);

        for (var row = 0; row < config.rows.length; row++) {
            var className = config.rows[row].className || '';
            var $row = (0, _jquery2.default)('<div class=\'row ' + className + '\'></div>');

            for (var b in config.rows[row].buttons) {
                $row.append(config.rows[row].buttons[b].$el);
                this.buttons.push(config.rows[row].buttons[b]);
            }

            this.$el.append($row);
        }

        this.memoryStack = new _MemoryPanel2.default(this.memoryManager, { className: 'memoryStackPanel' });
        this.history = new _HistoryPanel2.default(this.historyManager, { className: 'historyPanel' });

        this.$el.append(this.memoryStack.$el);
        this.$el.append(this.history.$el);
    };

    var _jquery2 = _interopRequireDefault(_jquery);

    var _Panel2 = _interopRequireDefault(_Panel);

    var _HistoryPanel2 = _interopRequireDefault(_HistoryPanel);

    var _MemoryPanel2 = _interopRequireDefault(_MemoryPanel);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }
});
//# sourceMappingURL=layout.js.map
;
define('calculator/lib/Layout',['exports', 'jquery', './behaviours/Referencable', './behaviours/Resizer', './builder/layout', 'calculator/constant/TokenManagerStates'], function (exports, _jquery, _Referencable2, _Resizer, _layout, _TokenManagerStates) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    var _Referencable3 = _interopRequireDefault(_Referencable2);

    var _Resizer2 = _interopRequireDefault(_Resizer);

    var _layout2 = _interopRequireDefault(_layout);

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    function _possibleConstructorReturn(self, call) {
        if (!self) {
            throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        }

        return call && (typeof call === "object" || typeof call === "function") ? call : self;
    }

    function _inherits(subClass, superClass) {
        if (typeof superClass !== "function" && superClass !== null) {
            throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
        }

        subClass.prototype = Object.create(superClass && superClass.prototype, {
            constructor: {
                value: subClass,
                enumerable: false,
                writable: true,
                configurable: true
            }
        });
        if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
    }

    var Layout = function (_Referencable) {
        _inherits(Layout, _Referencable);

        function Layout(tokenManager, historyManager, memoryManager, config) {
            _classCallCheck(this, Layout);

            var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(Layout).call(this));

            _this.buttons = [];
            _this.tokenManager = tokenManager;
            _this.historyManager = historyManager;
            _this.memoryManager = memoryManager;

            createLayout.call(_this, config);

            _this.resizer = new _Resizer2.default(_this);

            _this.tokenManager.change(renderExpression, _this);
            _this.tokenManager.change(renderAnswer, _this);
            _this.tokenManager.custom(renderCustomExpressionAndAnswer, _this);
            _this.tokenManager.evaluation(renderEvaluationAnswer, _this);
            renderAnswer.call(_this);
            return _this;
        }

        _createClass(Layout, [{
            key: 'resizeLayout',
            value: function resizeLayout() {
                this.resizer.start();
            }
        }]);

        return Layout;
    }(_Referencable3.default);

    exports.default = Layout;


    function createLayout(config) {
        if (!config) {
            return;
        }

        _layout2.default.call(this, config);
    }

    function renderExpression() {
        this.$expressionArea.html(this.tokenManager.expressionStr);
    }
    function renderAnswer() {
        displayValidAnswer.call(this, this.tokenManager.answerStr);
    }

    function renderEvaluationAnswer(answer) {
        displayValidAnswer.call(this, answer);
    }

    function displayValidAnswer(answer) {
        if (this.tokenManager.state === _TokenManagerStates2.default.INVALID) {
            this.$answer.html('Invalid input');
        } else {
            this.$answer.html(answer);
        }
    }

    function renderCustomExpressionAndAnswer(expression, answer) {
        this.$expressionArea.html(expression);
        displayValidAnswer.call(this, answer);
    }
});
//# sourceMappingURL=Layout.js.map
;
define('calculator/lib/managers/CalculationManager',['exports', 'calculator/utils'], function (exports, _utils) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _slicedToArray = function () {
        function sliceIterator(arr, i) {
            var _arr = [];
            var _n = true;
            var _d = false;
            var _e = undefined;

            try {
                for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
                    _arr.push(_s.value);

                    if (i && _arr.length === i) break;
                }
            } catch (err) {
                _d = true;
                _e = err;
            } finally {
                try {
                    if (!_n && _i["return"]) _i["return"]();
                } finally {
                    if (_d) throw _e;
                }
            }

            return _arr;
        }

        return function (arr, i) {
            if (Array.isArray(arr)) {
                return arr;
            } else if (Symbol.iterator in Object(arr)) {
                return sliceIterator(arr, i);
            } else {
                throw new TypeError("Invalid attempt to destructure non-iterable instance");
            }
        };
    }();

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var _class = function () {
        function _class(calculations, tokenManager) {
            _classCallCheck(this, _class);

            this.calculations = calculations;
            this.tokenManager = tokenManager;
        }

        _createClass(_class, [{
            key: 'registerButton',
            value: function registerButton(button) {
                if (!button.calculations) {
                    return;
                }

                button.$el.on('keypress', function (e, button) {
                    onKeypress.call(this, button);
                }.bind(this));
            }
        }]);

        return _class;
    }();

    exports.default = _class;


    function onKeypress(button) {
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
            for (var _iterator = (0, _utils.objectEntries)(button.calculations)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                var _step$value = _slicedToArray(_step.value, 2);

                var objectName = _step$value[0];
                var objectValue = _step$value[1];

                var calculation = this.calculations.getCalculation(objectValue.calculationName);
                if (!calculation) {
                    return;
                }

                calculation.apply(calculation, [this.tokenManager, button]);
            }
        } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
        } finally {
            try {
                if (!_iteratorNormalCompletion && _iterator.return) {
                    _iterator.return();
                }
            } finally {
                if (_didIteratorError) {
                    throw _iteratorError;
                }
            }
        }
    }
});
//# sourceMappingURL=CalculationManager.js.map
;
define('calculator/lib/managers/ActionManager',['exports', 'calculator/utils'], function (exports, _utils) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _slicedToArray = function () {
        function sliceIterator(arr, i) {
            var _arr = [];
            var _n = true;
            var _d = false;
            var _e = undefined;

            try {
                for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
                    _arr.push(_s.value);

                    if (i && _arr.length === i) break;
                }
            } catch (err) {
                _d = true;
                _e = err;
            } finally {
                try {
                    if (!_n && _i["return"]) _i["return"]();
                } finally {
                    if (_d) throw _e;
                }
            }

            return _arr;
        }

        return function (arr, i) {
            if (Array.isArray(arr)) {
                return arr;
            } else if (Symbol.iterator in Object(arr)) {
                return sliceIterator(arr, i);
            } else {
                throw new TypeError("Invalid attempt to destructure non-iterable instance");
            }
        };
    }();

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var _class = function () {
        function _class(actions, layout) {
            _classCallCheck(this, _class);

            this.actions = actions;
            this.layout = layout;
        }

        _createClass(_class, [{
            key: 'registerButton',
            value: function registerButton(button) {
                if (!button.actions) {
                    return;
                }

                button.$el.on('keypress', function (e, button) {
                    onKeypress.call(this, button);
                }.bind(this));
            }
        }]);

        return _class;
    }();

    exports.default = _class;


    function onKeypress(button) {
        var _iteratorNormalCompletion = true;
        var _didIteratorError = false;
        var _iteratorError = undefined;

        try {
            for (var _iterator = (0, _utils.objectEntries)(button.actions)[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                var _step$value = _slicedToArray(_step.value, 2);

                var objectName = _step$value[0];
                var objectValue = _step$value[1];

                var action = this.actions.getAction(objectValue.actionName);
                if (!action) {
                    return;
                }

                var actionArgs = getActionArgs.call(this, objectValue.actionArgs);

                action.apply(action, actionArgs);
            }
        } catch (err) {
            _didIteratorError = true;
            _iteratorError = err;
        } finally {
            try {
                if (!_iteratorNormalCompletion && _iterator.return) {
                    _iterator.return();
                }
            } finally {
                if (_didIteratorError) {
                    throw _iteratorError;
                }
            }
        }
    }

    function getActionArgs(argStrings) {
        var actionArgs = [];

        var _iteratorNormalCompletion2 = true;
        var _didIteratorError2 = false;
        var _iteratorError2 = undefined;

        try {
            for (var _iterator2 = argStrings[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                var argString = _step2.value;

                var arg = argString;

                if (arg[0] === '&') {
                    arg = this.layout.getReference(arg);
                }

                actionArgs.push(arg);
            }
        } catch (err) {
            _didIteratorError2 = true;
            _iteratorError2 = err;
        } finally {
            try {
                if (!_iteratorNormalCompletion2 && _iterator2.return) {
                    _iterator2.return();
                }
            } finally {
                if (_didIteratorError2) {
                    throw _iteratorError2;
                }
            }
        }

        return actionArgs;
    }
});
//# sourceMappingURL=ActionManager.js.map
;
define('calculator/lib/event/EventApi',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var events = Symbol('events');

    var EventObject = function () {
        function EventObject(funct, context) {
            _classCallCheck(this, EventObject);

            this.funct = funct;
            this.context = context;
        }

        _createClass(EventObject, [{
            key: 'call',
            value: function call() {
                this.funct.apply(this.context, arguments);
            }
        }]);

        return EventObject;
    }();

    var EventApi = function () {
        function EventApi() {
            _classCallCheck(this, EventApi);

            this[events] = {};
        }

        _createClass(EventApi, [{
            key: 'on',
            value: function on(eventName, funct, context) {
                if (!this[events][eventName]) {
                    this[events][eventName] = [];
                }
                this[events][eventName].push(new EventObject(funct, context));
            }
        }, {
            key: 'trigger',
            value: function trigger(eventName) {
                for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                    args[_key - 1] = arguments[_key];
                }

                if (!this[events][eventName]) {
                    return;
                }

                this[events][eventName].forEach(function (eventObj) {
                    eventObj.call.apply(eventObj, args);
                });
            }
        }]);

        return EventApi;
    }();

    exports.default = EventApi;
});
//# sourceMappingURL=EventApi.js.map
;
define('calculator/lib/managers/TokenManager',['exports', 'calculator/token', 'calculator/constant/TokenManagerStates', 'calculator/constant/TokenManagerEvents', 'calculator/lib/event/EventApi'], function (exports, _token, _TokenManagerStates, _TokenManagerEvents, _EventApi) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    var _TokenManagerEvents2 = _interopRequireDefault(_TokenManagerEvents);

    var _EventApi2 = _interopRequireDefault(_EventApi);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var eventApi = Symbol('eventApi');
    var stateTracker = Symbol('stateTracker');

    var _class = function () {
        function _class() {
            _classCallCheck(this, _class);

            this[eventApi] = new _EventApi2.default();
            this[stateTracker] = 0;

            this.tokens = ['0'];
            this.state = _TokenManagerStates2.default.NORMAL;

            createAccessors.call(this);
        }

        _createClass(_class, [{
            key: 'change',
            value: function change(funct, context) {
                this[eventApi].on(_TokenManagerEvents2.default.CHANGE, funct, context);
            }
        }, {
            key: 'evaluation',
            value: function evaluation(funct, context) {
                this[eventApi].on(_TokenManagerEvents2.default.EVALUATION, funct, context);
            }
        }, {
            key: 'custom',
            value: function custom(funct, context) {
                this[eventApi].on(_TokenManagerEvents2.default.CUSTOM, funct, context);
            }
        }, {
            key: 'trigger',
            value: function trigger(eventName) {
                for (var _len = arguments.length, arg = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                    arg[_key - 1] = arguments[_key];
                }

                arg = eventName === _TokenManagerEvents2.default.EVALUATION ? [(0, _token.evaluateTokens)(this.tokens)] : arg;

                this[eventApi].trigger.apply(this[eventApi], [eventName].concat(arg));
            }
        }, {
            key: 'setToInvalid',
            value: function setToInvalid() {
                updateState.call(this, _TokenManagerStates2.default.INVALID);
                this.trigger(_TokenManagerEvents2.default.CHANGE);
            }
        }, {
            key: 'push',
            value: function push(value, options) {
                updateState.call(this, _TokenManagerStates2.default.NORMAL);

                options = options || {};

                if (options.replace) {
                    this.tokens.pop();
                }

                this.tokens.push(value);
                this.trigger(_TokenManagerEvents2.default.CHANGE);
            }
        }, {
            key: 'evaluate',
            value: function evaluate() {
                updateState.call(this, _TokenManagerStates2.default.EVALUATED);

                var value = (0, _token.evaluateTokens)(this.tokens);
                var tokens = this.tokens.slice(0);
                this.tokens.splice(0);

                this.tokens.push(value);
                this.trigger(_TokenManagerEvents2.default.CHANGE, tokens);
            }
        }, {
            key: 'hasAlreadyEvaluated',
            value: function hasAlreadyEvaluated() {
                return this[stateTracker] !== 1;
            }
        }, {
            key: 'isLastToken',
            value: function isLastToken(tokens) {
                if (!this.tokens.length) return false;

                var lastToken = this.tokens[this.tokens.length - 1];

                for (var i = 0; i < tokens.length; ++i) {
                    if (lastToken === tokens[i]) {
                        return true;
                    }
                }

                return false;
            }
        }, {
            key: 'applyHistory',
            value: function applyHistory(history) {
                updateState.call(this, _TokenManagerStates2.default.NORMAL);

                this.tokens.splice(0);
                this.tokens.push.apply(this.tokens, history.tokens);

                this.trigger(_TokenManagerEvents2.default.CUSTOM, (0, _token.toString)(history.tokens), (0, _token.evaluateTokens)(history.tokens));
            }
        }, {
            key: 'memoryClick',
            value: function memoryClick() {
                updateState.call(this, _TokenManagerStates2.default.EVALUATED);
            }
        }, {
            key: 'clear',
            value: function clear(last) {
                updateState.call(this, _TokenManagerStates2.default.NORMAL);
                if (!last) {
                    this.tokens.splice(0);
                } else {
                    var lastOperatorIndex = (0, _token.getLastOperatorIndex)(this.tokens);
                    this.tokens.splice(lastOperatorIndex + 1, this.tokens.length);
                }

                this.tokens.push('0');

                this.trigger(_TokenManagerEvents2.default.CHANGE);
            }
        }]);

        return _class;
    }();

    exports.default = _class;


    function createAccessors() {
        var _this = this;

        Object.defineProperties(this, {
            'expressionStr': {
                get: function get() {
                    var lastOperatorIndex = (0, _token.getLastOperatorIndex)(_this.tokens);
                    if (_this.tokens[_this.tokens.length - 1].type) {
                        return (0, _token.toString)(_this.tokens.slice(0, _this.tokens.length));
                    }
                    return (0, _token.toString)(_this.tokens.slice(0, lastOperatorIndex + 1));
                }
            },
            'answerStr': {
                get: function get() {
                    var lastOperatorIndex = (0, _token.getLastOperatorIndex)(_this.tokens);
                    if (_this.tokens[_this.tokens.length - 1].type) {
                        return '';
                    }
                    return (0, _token.toString)(_this.tokens.slice(lastOperatorIndex + 1));
                }
            }
        });
    }

    function updateState(state) {
        this.state = state;
        if (state === _TokenManagerStates2.default.EVALUATED) {
            this[stateTracker]++;
        } else {
            this[stateTracker] = 0;
        }
    }
});
//# sourceMappingURL=TokenManager.js.map
;
define('calculator/lib/model/History',["exports"], function (exports) {
    "use strict";

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _class = function _class(tokens, answer) {
        _classCallCheck(this, _class);

        this.tokens = tokens;
        this.answer = answer;
    };

    exports.default = _class;
});
//# sourceMappingURL=History.js.map
;
define('calculator/lib/managers/HistoryManager',['exports', 'calculator/constant/TokenManagerStates', 'calculator/lib/model/History', 'calculator/lib/event/EventApi', 'calculator/constant/HistoryManagerEvents', 'calculator/constant/Panel'], function (exports, _TokenManagerStates, _History, _EventApi2, _HistoryManagerEvents, _Panel) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    var _History2 = _interopRequireDefault(_History);

    var _EventApi3 = _interopRequireDefault(_EventApi2);

    var _HistoryManagerEvents2 = _interopRequireDefault(_HistoryManagerEvents);

    var _Panel2 = _interopRequireDefault(_Panel);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    function _possibleConstructorReturn(self, call) {
        if (!self) {
            throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        }

        return call && (typeof call === "object" || typeof call === "function") ? call : self;
    }

    function _inherits(subClass, superClass) {
        if (typeof superClass !== "function" && superClass !== null) {
            throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
        }

        subClass.prototype = Object.create(superClass && superClass.prototype, {
            constructor: {
                value: subClass,
                enumerable: false,
                writable: true,
                configurable: true
            }
        });
        if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
    }

    var previousTokens = Symbol('previousTokens');

    var _class = function (_EventApi) {
        _inherits(_class, _EventApi);

        function _class(tokenManager) {
            _classCallCheck(this, _class);

            var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(_class).call(this));

            _this.historyStates = [];
            _this[previousTokens] = null;

            _this.tokenManager = tokenManager;
            _this.tokenManager.change(onChange, _this);
            return _this;
        }

        _createClass(_class, [{
            key: 'registerHistory',
            value: function registerHistory(view, state, $parentView) {
                var _this2 = this;

                view.$el.on('click', function () {
                    _this2.tokenManager.applyHistory(state);
                    $parentView.trigger(_Panel2.default.CLOSE_EVENT);
                });
            }
        }, {
            key: 'clear',
            value: function clear() {
                this.historyStates = [];
                this.trigger(_HistoryManagerEvents2.default.CHANGE);
            }
        }]);

        return _class;
    }(_EventApi3.default);

    exports.default = _class;


    function onChange(tokens) {
        if (this.tokenManager.state !== _TokenManagerStates2.default.EVALUATED) {
            return;
        }
        if (this.tokenManager.hasAlreadyEvaluated()) {
            return;
        }

        this.historyStates.push(new _History2.default(tokens, this.tokenManager.answerStr));
        this[previousTokens] = tokens;
        this.trigger(_HistoryManagerEvents2.default.CHANGE);
    }
});
//# sourceMappingURL=HistoryManager.js.map
;
define('calculator/constant/HistoryStateEvents',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    var HistoryStateEvents = {};

    Object.defineProperties(HistoryStateEvents, {
        CLEAR: { value: 'clear' },
        PLUS: { value: 'plus' },
        MINUS: { value: 'minus' }
    });

    exports.default = HistoryStateEvents;
});
//# sourceMappingURL=HistoryStateEvents.js.map
;

define('text!templates/memoryState.tpl',[],function () { return '<div class="memory-state">\r\n    <div class="value"></div>\r\n    <div class="footer">\r\n        <div class="memoryClear">MC</div>\r\n        <div class="memoryPlus">M+</div>\r\n        <div class="memoryMinus">M-</div>\r\n    </div>\r\n</div>';});

define('calculator/lib/Memory',['exports', 'jquery', 'calculator/constant/HistoryStateEvents', 'text!templates/memoryState.tpl'], function (exports, _jquery, _HistoryStateEvents, _memoryState) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    var _HistoryStateEvents2 = _interopRequireDefault(_HistoryStateEvents);

    var _memoryState2 = _interopRequireDefault(_memoryState);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var $value = Symbol('$value');

    var _class = function () {
        function _class(value) {
            _classCallCheck(this, _class);

            this.$el = (0, _jquery2.default)(_memoryState2.default);

            this[$value] = this.$el.find('.value');
            this.value = parseFloat(value);
            build.call(this);
        }

        _createClass(_class, [{
            key: 'plusToValue',
            value: function plusToValue(toAdd) {
                this.value += parseFloat(toAdd);
                updateValueInView.call(this);
            }
        }, {
            key: 'minusFromValue',
            value: function minusFromValue(toMinus) {
                this.value -= parseFloat(toMinus);
                updateValueInView.call(this);
            }
        }]);

        return _class;
    }();

    exports.default = _class;

    function build() {
        updateValueInView.call(this);
        this.$el.find('.memoryClear').on('click', clear.bind(this));
        this.$el.find('.memoryPlus').on('click', plus.bind(this));
        this.$el.find('.memoryMinus').on('click', minus.bind(this));
    }

    function updateValueInView() {
        this[$value].html(this.value);
    }

    function clear() {
        this.$el.remove();
        (0, _jquery2.default)(this).trigger(_HistoryStateEvents2.default.CLEAR, this);
    }

    function plus() {
        (0, _jquery2.default)(this).trigger(_HistoryStateEvents2.default.PLUS, this);
    }

    function minus() {
        (0, _jquery2.default)(this).trigger(_HistoryStateEvents2.default.MINUS, this);
    }
});
//# sourceMappingURL=Memory.js.map
;
define('calculator/constant/MemoryManagerEvents',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    var MemoryManagerEvents = {};

    Object.defineProperties(MemoryManagerEvents, {
        CHANGE: { value: 'change' }
    });

    exports.default = MemoryManagerEvents;
});
//# sourceMappingURL=MemoryManagerEvents.js.map
;
define('calculator/lib/managers/MemoryManager',['exports', 'jquery', 'calculator/lib/event/EventApi', 'calculator/lib/Memory', 'calculator/constant/MemoryManagerEvents', 'calculator/constant/HistoryStateEvents'], function (exports, _jquery, _EventApi, _Memory, _MemoryManagerEvents, _HistoryStateEvents) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    var _EventApi2 = _interopRequireDefault(_EventApi);

    var _Memory2 = _interopRequireDefault(_Memory);

    var _MemoryManagerEvents2 = _interopRequireDefault(_MemoryManagerEvents);

    var _HistoryStateEvents2 = _interopRequireDefault(_HistoryStateEvents);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _createClass = function () {
        function defineProperties(target, props) {
            for (var i = 0; i < props.length; i++) {
                var descriptor = props[i];
                descriptor.enumerable = descriptor.enumerable || false;
                descriptor.configurable = true;
                if ("value" in descriptor) descriptor.writable = true;
                Object.defineProperty(target, descriptor.key, descriptor);
            }
        }

        return function (Constructor, protoProps, staticProps) {
            if (protoProps) defineProperties(Constructor.prototype, protoProps);
            if (staticProps) defineProperties(Constructor, staticProps);
            return Constructor;
        };
    }();

    var eventApi = Symbol('eventApi');
    var memoryStack = Symbol('memoryStack');
    var tokenManager = Symbol('tokenManager');

    var _class = function () {
        function _class(tManager) {
            _classCallCheck(this, _class);

            this[eventApi] = new _EventApi2.default();
            this[memoryStack] = [];
            this[tokenManager] = tManager;
        }

        _createClass(_class, [{
            key: 'change',
            value: function change(funct, context) {
                this.on(_MemoryManagerEvents2.default.CHANGE, funct, context);
            }
        }, {
            key: 'on',
            value: function on(eventName, funct, context) {
                this[eventApi].on(eventName, funct, context);
            }
        }, {
            key: 'trigger',
            value: function trigger(eventName) {
                for (var _len = arguments.length, arg = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                    arg[_key - 1] = arguments[_key];
                }

                this[eventApi].trigger.apply(this[eventApi], [eventName].concat(arg));
            }
        }, {
            key: 'getMemoryStack',
            value: function getMemoryStack() {
                return this[memoryStack];
            }
        }, {
            key: 'getLast',
            value: function getLast() {
                var stack = this.getMemoryStack();
                return stack[stack.length - 1];
            }
        }, {
            key: 'clear',
            value: function clear(state) {
                var stack = void 0;

                if (state) {
                    state.$el.remove();
                    stack = removeAtIndex(this[memoryStack], this[memoryStack].indexOf(state));
                } else {
                    this[memoryStack].forEach(function (v) {
                        return v.$el.remove();
                    });
                    stack = [];
                }

                this[memoryStack] = stack;
                this.trigger(_MemoryManagerEvents2.default.CHANGE);
            }
        }, {
            key: 'restore',
            value: function restore() {
                var length = this[memoryStack].length;
                if (length === 0) {
                    return null;
                }
                return this[memoryStack][length - 1].value;
            }
        }, {
            key: 'plus',
            value: function plus(state, value) {
                var length = this[memoryStack].length;
                value = value === undefined ? this[tokenManager].answerStr : value;
                if (length === 0) {
                    this.save(value.toString());
                    return;
                }
                var index = state ? this[memoryStack].indexOf(state) : length - 1;
                this[memoryStack][index].plusToValue(parseFloat(value));
            }
        }, {
            key: 'minus',
            value: function minus(state, value) {
                var length = this[memoryStack].length;
                value = value === undefined ? this[tokenManager].answerStr : value;
                if (length === 0) {
                    this.save((-value).toString());
                    return;
                }
                var index = state ? this[memoryStack].indexOf(state) : length - 1;
                this[memoryStack][index].minusFromValue(parseFloat(value));
            }
        }, {
            key: 'save',
            value: function save(value) {
                var _this = this;

                var view = new _Memory2.default(value);
                var $view = (0, _jquery2.default)(view);

                $view.on(_HistoryStateEvents2.default.CLEAR, function () {
                    _this.clear.call(_this, view);
                });
                $view.on(_HistoryStateEvents2.default.PLUS, function () {
                    _this.plus.call(_this, view);
                });
                $view.on(_HistoryStateEvents2.default.MINUS, function () {
                    _this.minus.call(_this, view);
                });

                this[memoryStack].push(view);
                this.trigger(_MemoryManagerEvents2.default.CHANGE);
            }
        }]);

        return _class;
    }();

    exports.default = _class;


    function removeAtIndex(array, index) {
        return array.slice(0, index).concat(array.slice(index + 1));
    }
});
//# sourceMappingURL=MemoryManager.js.map
;
define('calculator/lib/changes/ToggleDisableWhenEmpty',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    exports.default = function (manager, button) {
        button.$el.toggleClass('disabled', manager.getMemoryStack().length === 0);
    };
});
//# sourceMappingURL=ToggleDisableWhenEmpty.js.map
;
define('calculator/lib/changes/ToggleDisableWhenInvalid',['exports', 'calculator/constant/TokenManagerStates'], function (exports, _TokenManagerStates) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _TokenManagerStates2 = _interopRequireDefault(_TokenManagerStates);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = function (manager, button) {
        button.$el.toggleClass('disabled', manager.state === _TokenManagerStates2.default.INVALID);
    };
});
//# sourceMappingURL=ToggleDisableWhenInvalid.js.map
;
define('calculator/config/changes',['exports', '../lib/changes/ToggleDisableWhenEmpty', '../lib/changes/ToggleDisableWhenInvalid'], function (exports, _ToggleDisableWhenEmpty, _ToggleDisableWhenInvalid) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _ToggleDisableWhenEmpty2 = _interopRequireDefault(_ToggleDisableWhenEmpty);

    var _ToggleDisableWhenInvalid2 = _interopRequireDefault(_ToggleDisableWhenInvalid);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = {
        'ToggleDisableWhenEmpty': _ToggleDisableWhenEmpty2.default,
        'ToggleDisableWhenInvalid': _ToggleDisableWhenInvalid2.default
    };
});
//# sourceMappingURL=changes.js.map
;
define('calculator/lib/managers/ChangeManager',['exports', 'calculator/lib/event/EventApi', 'calculator/lib/behaviours/Referencable', 'calculator/config/changes'], function (exports, _EventApi, _Referencable2, _changes) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _EventApi2 = _interopRequireDefault(_EventApi);

    var _Referencable3 = _interopRequireDefault(_Referencable2);

    var _changes2 = _interopRequireDefault(_changes);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    function _possibleConstructorReturn(self, call) {
        if (!self) {
            throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        }

        return call && (typeof call === "object" || typeof call === "function") ? call : self;
    }

    function _inherits(subClass, superClass) {
        if (typeof superClass !== "function" && superClass !== null) {
            throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
        }

        subClass.prototype = Object.create(superClass && superClass.prototype, {
            constructor: {
                value: subClass,
                enumerable: false,
                writable: true,
                configurable: true
            }
        });
        if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
    }

    var changes = Symbol('changes');

    var _class = function (_Referencable) {
        _inherits(_class, _Referencable);

        function _class(tokenManager, memoryManager, config) {
            _classCallCheck(this, _class);

            var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(_class).call(this));

            _this[changes] = _changes2.default;
            _this.tokenManager = tokenManager;
            _this.memoryManager = memoryManager;

            var _iteratorNormalCompletion = true;
            var _didIteratorError = false;
            var _iteratorError = undefined;

            try {
                for (var _iterator = config.toolbar.buttons[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                    var _button = _step.value;

                    processChanges.call(_this, _button);
                }
            } catch (err) {
                _didIteratorError = true;
                _iteratorError = err;
            } finally {
                try {
                    if (!_iteratorNormalCompletion && _iterator.return) {
                        _iterator.return();
                    }
                } finally {
                    if (_didIteratorError) {
                        throw _iteratorError;
                    }
                }
            }

            for (var row = 0; row < config.rows.length; row++) {
                var _iteratorNormalCompletion2 = true;
                var _didIteratorError2 = false;
                var _iteratorError2 = undefined;

                try {
                    for (var _iterator2 = config.rows[row].buttons[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                        var button = _step2.value;

                        processChanges.call(_this, button);
                    }
                } catch (err) {
                    _didIteratorError2 = true;
                    _iteratorError2 = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion2 && _iterator2.return) {
                            _iterator2.return();
                        }
                    } finally {
                        if (_didIteratorError2) {
                            throw _iteratorError2;
                        }
                    }
                }
            }
            return _this;
        }

        return _class;
    }(_Referencable3.default);

    exports.default = _class;


    function processChanges(button) {
        var _this2 = this;

        var _loop = function _loop(change) {
            if (!button.changes.hasOwnProperty(change)) {
                return 'continue';
            }
            var manager = _this2.getReference(button.changes[change].on);
            var changeFunc = getChange.call(_this2, button.changes[change].changeName);
            manager.change(function () {
                changeFunc(manager, button);
            });
        };

        for (var change in button.changes) {
            var _ret = _loop(change);

            if (_ret === 'continue') continue;
        }
    }

    function getChange(changeName) {
        return this[changes][changeName];
    }
});
//# sourceMappingURL=ChangeManager.js.map
;
define('calculator/config/buttons',['exports'], function (exports) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });
    exports.default = {
        'HISTORY': { 'html': '<span class="icon icon-history">', 'class': 'history',
            'actions': {
                'toggle': { 'actionName': 'ToggleClass', 'actionArgs': ['&history', 'displayNone'] }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'MC': { 'html': 'MC', 'class': 'mc disabled',
            'actions': {
                'memoryClear': { 'actionName': 'MemoryClear', 'actionArgs': ['&memoryManager'] }
            },
            'changes': {
                'toggleDisableWhenEmpty': { 'changeName': 'ToggleDisableWhenEmpty', 'on': '&memoryManager' },
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'MR': { 'html': 'MR', 'class': 'mr disabled',
            'actions': {
                'memoryRestore': { 'actionName': 'MemoryRestore', 'actionArgs': ['&tokenManager', '&memoryManager'] }
            },
            'changes': {
                'toggleDisableWhenEmpty': { 'changeName': 'ToggleDisableWhenEmpty', 'on': '&memoryManager' },
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'M_PLUS': { 'html': 'M+', 'class': 'm-plus',
            'actions': {
                'memoryPlus': { 'actionName': 'MemoryPlus', 'actionArgs': ['&tokenManager', '&memoryManager'] }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'M_MINUS': { 'html': 'M-', 'class': 'm-minus',
            'actions': {
                'memoryMinus': { 'actionName': 'MemoryMinus', 'actionArgs': ['&tokenManager', '&memoryManager'] }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'MS': { 'html': 'MS', 'class': 'ms',
            'actions': {
                'memorySave': { 'actionName': 'MemorySave', 'actionArgs': ['&tokenManager', '&memoryManager'] }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'M_STACK': { 'html': 'M <div class="triangle down">', 'class': 'm-stack',
            'actions': {
                'toggle': { 'actionName': 'ToggleClass', 'actionArgs': ['&memoryStack', 'displayNone'] }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'PERCENT': { 'html': '%', 'class': 'percent',
            'calculations': {
                'percent': { 'calculationName': 'Percent' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'SQRT': { 'html': '&radic;', 'class': 'sqrt',
            'calculations': {
                'sqrt': { 'calculationName': 'Sqrt' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'SQUARED': { 'html': '<span class="math">x</span><sup>2</sup>', 'class': 'squared',
            'calculations': {
                'square': { 'calculationName': 'Square' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'FRAC': { 'html': '<sup>1</sup>/<span class="math">x</span>', 'class': 'frac',
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'CE': { 'html': 'CE', 'class': 'ce',
            'calculations': {
                'clear': { 'calculationName': 'ClearLastTokens' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'C': { 'html': 'C', 'class': 'c',
            'calculations': {
                'clear': { 'calculationName': 'ClearTokens' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'BACKSPACE': { 'html': '<span class="icon icon-backspace">', 'class': 'backspace',
            'calculations': {
                'backspace': { 'calculationName': 'Backspace' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'DIVIDE': { 'html': '&divide;', 'class': 'divide', 'mathSymbol': '&divide;',
            'calculations': {
                'add': { 'calculationName': 'AddArithmeticToken' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'SEVEN': { 'html': '7', 'class': 'number-7', 'mathSymbol': '7',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'EIGHT': { 'html': '8', 'class': 'number-8', 'mathSymbol': '8',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'NINE': { 'html': '9', 'class': 'number-9', 'mathSymbol': '9',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'TIMES': { 'html': '&times;', 'class': 'times', 'mathSymbol': '&times;',
            'calculations': {
                'add': { 'calculationName': 'AddArithmeticToken' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'FOUR': { 'html': '4', 'class': 'number-4', 'mathSymbol': '4',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'FIVE': { 'html': '5', 'class': 'number-5', 'mathSymbol': '5',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'SIX': { 'html': '6', 'class': 'number-6', 'mathSymbol': '6',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'MINUS': { 'html': '-', 'class': 'minus', 'mathSymbol': '-',
            'calculations': {
                'add': { 'calculationName': 'AddArithmeticToken' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'ONE': { 'html': '1', 'class': 'number-1', 'mathSymbol': '1',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'TWO': { 'html': '2', 'class': 'number-2', 'mathSymbol': '2',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'THREE': { 'html': '3', 'class': 'number-3', 'mathSymbol': '3',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'PLUS': { 'html': '+', 'class': 'plus', 'mathSymbol': '+',
            'calculations': {
                'add': { 'calculationName': 'AddArithmeticToken' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'PLUS_MINUS': { 'html': '&plusmn;', 'class': 'plus-minus',
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'ZERO': { 'html': '0', 'class': 'number-0', 'mathSymbol': '0',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            }
        },
        'DECIMAL': { 'html': '.', 'class': 'decimal', 'mathSymbol': '.',
            'calculations': {
                'add': { 'calculationName': 'AddNumberToken' }
            },
            'changes': {
                'toggleDisableWhenInvalid': { 'changeName': 'ToggleDisableWhenInvalid', 'on': '&tokenManager' }
            }
        },
        'EQUAL': { 'html': '=', 'class': 'equal',
            'calculations': {
                'evaluate': { 'calculationName': 'Evaluate' }
            }
        }
    };
});
//# sourceMappingURL=buttons.js.map
;
define('calculator/lib/Button',['exports', 'jquery'], function (exports, _jquery) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _jquery2 = _interopRequireDefault(_jquery);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    function _classCallCheck(instance, Constructor) {
        if (!(instance instanceof Constructor)) {
            throw new TypeError("Cannot call a class as a function");
        }
    }

    var _class = function _class(id, config) {
        _classCallCheck(this, _class);

        this.id = id;
        this.html = config.html;
        this.class = config.class;
        this.mathSymbol = config.mathSymbol;
        this.actions = config.actions;
        this.calculations = config.calculations;
        this.changes = config.changes;

        this.$el = (0, _jquery2.default)('<div class=\'calc-button ' + this.class + '\'>' + this.html + '</div>');

        this.$el.on('mousedown', function (e) {
            return (0, _jquery2.default)(e.currentTarget).addClass('pressed');
        });
        this.$el.on('mouseup mouseout', function (e) {
            return (0, _jquery2.default)(e.currentTarget).removeClass('pressed');
        });
        this.$el.on('click', onClick.bind(this));
    };

    exports.default = _class;


    function onClick() {
        this.$el.trigger('keypress', this);
    }
});
//# sourceMappingURL=Button.js.map
;
define('calculator/constant/Buttons',['exports', '../config/buttons', '../lib/Button'], function (exports, _buttons, _Button) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _buttons2 = _interopRequireDefault(_buttons);

    var _Button2 = _interopRequireDefault(_Button);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    var Buttons = {};

    for (var b in _buttons2.default) {
        if (!_buttons2.default.hasOwnProperty(b)) {
            continue;
        }
        Buttons[b] = new _Button2.default(b, _buttons2.default[b]);
    }

    exports.default = Buttons;
});
//# sourceMappingURL=Buttons.js.map
;
define('calculator/config/standard',['exports', 'calculator/constant/Buttons'], function (exports, _Buttons) {
    'use strict';

    Object.defineProperty(exports, "__esModule", {
        value: true
    });

    var _Buttons2 = _interopRequireDefault(_Buttons);

    function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
            default: obj
        };
    }

    exports.default = {
        name: 'standard',
        toolbar: {
            buttons: [_Buttons2.default.HISTORY]
        },
        rows: [{
            buttons: [_Buttons2.default.MC, _Buttons2.default.MR, _Buttons2.default.M_PLUS, _Buttons2.default.M_MINUS, _Buttons2.default.MS, _Buttons2.default.M_STACK]
        }, {
            buttons: [_Buttons2.default.PERCENT, _Buttons2.default.SQRT, _Buttons2.default.SQUARED, _Buttons2.default.FRAC]
        }, {
            buttons: [_Buttons2.default.CE, _Buttons2.default.C, _Buttons2.default.BACKSPACE, _Buttons2.default.DIVIDE],
            className: 'main'
        }, {
            buttons: [_Buttons2.default.SEVEN, _Buttons2.default.EIGHT, _Buttons2.default.NINE, _Buttons2.default.TIMES],
            className: 'main'
        }, {
            buttons: [_Buttons2.default.FOUR, _Buttons2.default.FIVE, _Buttons2.default.SIX, _Buttons2.default.MINUS],
            className: 'main'
        }, {
            buttons: [_Buttons2.default.ONE, _Buttons2.default.TWO, _Buttons2.default.THREE, _Buttons2.default.PLUS],
            className: 'main'
        }, {
            buttons: [_Buttons2.default.PLUS_MINUS, _Buttons2.default.ZERO, _Buttons2.default.DECIMAL, _Buttons2.default.EQUAL],
            className: 'main'
        }]
    };
});
//# sourceMappingURL=standard.js.map
;
(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/// <reference path="../typings/tsd.d.ts" />


require("babel-polyfill");
},{"babel-polyfill":2}],2:[function(require,module,exports){
(function (global){


require("core-js/shim");

require("babel-regenerator-runtime");

if (global._babelPolyfill) {
  throw new Error("only one instance of babel-polyfill is allowed");
}
global._babelPolyfill = true;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"babel-regenerator-runtime":3,"core-js/shim":190}],3:[function(require,module,exports){
(function (process,global){
/**
 * Copyright (c) 2014, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

!(function(global) {
  "use strict";

  var hasOwn = Object.prototype.hasOwnProperty;
  var undefined; // More compressible than void 0.
  var iteratorSymbol =
    typeof Symbol === "function" && Symbol.iterator || "@@iterator";

  var inModule = typeof module === "object";
  var runtime = global.regeneratorRuntime;
  if (runtime) {
    if (inModule) {
      // If regeneratorRuntime is defined globally and we're in a module,
      // make the exports object identical to regeneratorRuntime.
      module.exports = runtime;
    }
    // Don't bother evaluating the rest of this file if the runtime was
    // already defined globally.
    return;
  }

  // Define the runtime globally (as expected by generated code) as either
  // module.exports (if we're in a module) or a new, empty object.
  runtime = global.regeneratorRuntime = inModule ? module.exports : {};

  function wrap(innerFn, outerFn, self, tryLocsList) {
    // If outerFn provided, then outerFn.prototype instanceof Generator.
    var generator = Object.create((outerFn || Generator).prototype);
    var context = new Context(tryLocsList || []);

    // The ._invoke method unifies the implementations of the .next,
    // .throw, and .return methods.
    generator._invoke = makeInvokeMethod(innerFn, self, context);

    return generator;
  }
  runtime.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function Generator() {}
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  var Gp = GeneratorFunctionPrototype.prototype = Generator.prototype;
  GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
  GeneratorFunctionPrototype.constructor = GeneratorFunction;
  GeneratorFunction.displayName = "GeneratorFunction";

  // Helper for defining the .next, .throw, and .return methods of the
  // Iterator interface in terms of a single ._invoke method.
  function defineIteratorMethods(prototype) {
    ["next", "throw", "return"].forEach(function(method) {
      prototype[method] = function(arg) {
        return this._invoke(method, arg);
      };
    });
  }

  runtime.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  runtime.mark = function(genFun) {
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(genFun, GeneratorFunctionPrototype);
    } else {
      genFun.__proto__ = GeneratorFunctionPrototype;
    }
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  // Within the body of any async function, `await x` is transformed to
  // `yield regeneratorRuntime.awrap(x)`, so that the runtime can test
  // `value instanceof AwaitArgument` to determine if the yielded value is
  // meant to be awaited. Some may consider the name of this method too
  // cutesy, but they are curmudgeons.
  runtime.awrap = function(arg) {
    return new AwaitArgument(arg);
  };

  function AwaitArgument(arg) {
    this.arg = arg;
  }

  function AsyncIterator(generator) {
    // This invoke function is written in a style that assumes some
    // calling function (or Promise) will handle exceptions.
    function invoke(method, arg) {
      var result = generator[method](arg);
      var value = result.value;
      return value instanceof AwaitArgument
        ? Promise.resolve(value.arg).then(invokeNext, invokeThrow)
        : Promise.resolve(value).then(function(unwrapped) {
            // When a yielded Promise is resolved, its final value becomes
            // the .value of the Promise<{value,done}> result for the
            // current iteration. If the Promise is rejected, however, the
            // result for this iteration will be rejected with the same
            // reason. Note that rejections of yielded Promises are not
            // thrown back into the generator function, as is the case
            // when an awaited Promise is rejected. This difference in
            // behavior between yield and await is important, because it
            // allows the consumer to decide what to do with the yielded
            // rejection (swallow it and continue, manually .throw it back
            // into the generator, abandon iteration, whatever). With
            // await, by contrast, there is no opportunity to examine the
            // rejection reason outside the generator function, so the
            // only option is to throw it from the await expression, and
            // let the generator function handle the exception.
            result.value = unwrapped;
            return result;
          });
    }

    if (typeof process === "object" && process.domain) {
      invoke = process.domain.bind(invoke);
    }

    var invokeNext = invoke.bind(generator, "next");
    var invokeThrow = invoke.bind(generator, "throw");
    var invokeReturn = invoke.bind(generator, "return");
    var previousPromise;

    function enqueue(method, arg) {
      function callInvokeWithMethodAndArg() {
        return invoke(method, arg);
      }

      return previousPromise =
        // If enqueue has been called before, then we want to wait until
        // all previous Promises have been resolved before calling invoke,
        // so that results are always delivered in the correct order. If
        // enqueue has not been called before, then it is important to
        // call invoke immediately, without waiting on a callback to fire,
        // so that the async generator function has the opportunity to do
        // any necessary setup in a predictable way. This predictability
        // is why the Promise constructor synchronously invokes its
        // executor callback, and why async functions synchronously
        // execute code before the first await. Since we implement simple
        // async functions in terms of async generators, it is especially
        // important to get this right, even though it requires care.
        previousPromise ? previousPromise.then(
          callInvokeWithMethodAndArg,
          // Avoid propagating failures to Promises returned by later
          // invocations of the iterator.
          callInvokeWithMethodAndArg
        ) : new Promise(function (resolve) {
          resolve(callInvokeWithMethodAndArg());
        });
    }

    // Define the unified helper method that is used to implement .next,
    // .throw, and .return (see defineIteratorMethods).
    this._invoke = enqueue;
  }

  defineIteratorMethods(AsyncIterator.prototype);

  // Note that simple async functions are implemented on top of
  // AsyncIterator objects; they just return a Promise for the value of
  // the final result produced by the iterator.
  runtime.async = function(innerFn, outerFn, self, tryLocsList) {
    var iter = new AsyncIterator(
      wrap(innerFn, outerFn, self, tryLocsList)
    );

    return runtime.isGeneratorFunction(outerFn)
      ? iter // If outerFn is a generator, return the full iterator.
      : iter.next().then(function(result) {
          return result.done ? result.value : iter.next();
        });
  };

  function makeInvokeMethod(innerFn, self, context) {
    var state = GenStateSuspendedStart;

    return function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        if (method === "throw") {
          throw arg;
        }

        // Be forgiving, per 25.3.3.3.3 of the spec:
        // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
        return doneResult();
      }

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          if (method === "return" ||
              (method === "throw" && delegate.iterator[method] === undefined)) {
            // A return or throw (when the delegate iterator has no throw
            // method) always terminates the yield* loop.
            context.delegate = null;

            // If the delegate iterator has a return method, give it a
            // chance to clean up.
            var returnMethod = delegate.iterator["return"];
            if (returnMethod) {
              var record = tryCatch(returnMethod, delegate.iterator, arg);
              if (record.type === "throw") {
                // If the return method threw an exception, let that
                // exception prevail over the original return or throw.
                method = "throw";
                arg = record.arg;
                continue;
              }
            }

            if (method === "return") {
              // Continue with the outer return, now that the delegate
              // iterator has been terminated.
              continue;
            }
          }

          var record = tryCatch(
            delegate.iterator[method],
            delegate.iterator,
            arg
          );

          if (record.type === "throw") {
            context.delegate = null;

            // Like returning generator.throw(uncaught), but without the
            // overhead of an extra function call.
            method = "throw";
            arg = record.arg;
            continue;
          }

          // Delegate generator ran and handled its own exceptions so
          // regardless of what the method was, we continue as if it is
          // "next" with an undefined arg.
          method = "next";
          arg = undefined;

          var info = record.arg;
          if (info.done) {
            context[delegate.resultName] = info.value;
            context.next = delegate.nextLoc;
          } else {
            state = GenStateSuspendedYield;
            return info;
          }

          context.delegate = null;
        }

        if (method === "next") {
          context._sent = arg;

          if (state === GenStateSuspendedYield) {
            context.sent = arg;
          } else {
            context.sent = undefined;
          }
        } else if (method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw arg;
          }

          if (context.dispatchException(arg)) {
            // If the dispatched exception was caught by a catch block,
            // then let that catch block handle the exception normally.
            method = "next";
            arg = undefined;
          }

        } else if (method === "return") {
          context.abrupt("return", arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          var info = {
            value: record.arg,
            done: context.done
          };

          if (record.arg === ContinueSentinel) {
            if (context.delegate && method === "next") {
              // Deliberately forget the last sent value so that we don't
              // accidentally pass it on to the delegate.
              arg = undefined;
            }
          } else {
            return info;
          }

        } else if (record.type === "throw") {
          state = GenStateCompleted;
          // Dispatch the exception by looping back around to the
          // context.dispatchException(arg) call above.
          method = "throw";
          arg = record.arg;
        }
      }
    };
  }

  // Define Generator.prototype.{next,throw,return} in terms of the
  // unified ._invoke helper method.
  defineIteratorMethods(Gp);

  Gp[iteratorSymbol] = function() {
    return this;
  };

  Gp.toString = function() {
    return "[object Generator]";
  };

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset(true);
  }

  runtime.keys = function(object) {
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    // Return an iterator with no values.
    return { next: doneResult };
  }
  runtime.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function(skipTempReset) {
      this.prev = 0;
      this.next = 0;
      this.sent = undefined;
      this.done = false;
      this.delegate = null;

      this.tryEntries.forEach(resetTryEntry);

      if (!skipTempReset) {
        for (var name in this) {
          // Not sure about the optimal order of these conditions:
          if (name.charAt(0) === "t" &&
              hasOwn.call(this, name) &&
              !isNaN(+name.slice(1))) {
            this[name] = undefined;
          }
        }
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;
        return !!caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    abrupt: function(type, arg) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") &&
            this.prev < entry.finallyLoc) {
          var finallyEntry = entry;
          break;
        }
      }

      if (finallyEntry &&
          (type === "break" ||
           type === "continue") &&
          finallyEntry.tryLoc <= arg &&
          arg <= finallyEntry.finallyLoc) {
        // Ignore the finally entry if control is not jumping to a
        // location outside the try/catch block.
        finallyEntry = null;
      }

      var record = finallyEntry ? finallyEntry.completion : {};
      record.type = type;
      record.arg = arg;

      if (finallyEntry) {
        this.next = finallyEntry.finallyLoc;
      } else {
        this.complete(record);
      }

      return ContinueSentinel;
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = record.arg;
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }
    },

    finish: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.finallyLoc === finallyLoc) {
          this.complete(entry.completion, entry.afterLoc);
          resetTryEntry(entry);
          return ContinueSentinel;
        }
      }
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      return ContinueSentinel;
    }
  };
})(
  // Among the various tricks for obtaining a reference to the global
  // object, this seems to be the most reliable technique that does not
  // use indirect eval (which violates Content Security Policy).
  typeof global === "object" ? global :
  typeof window === "object" ? window :
  typeof self === "object" ? self : this
);

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"_process":191}],4:[function(require,module,exports){
module.exports = function(it){
  if(typeof it != 'function')throw TypeError(it + ' is not a function!');
  return it;
};
},{}],5:[function(require,module,exports){
// 22.1.3.31 Array.prototype[@@unscopables]
var UNSCOPABLES = require('./$.wks')('unscopables')
  , ArrayProto  = Array.prototype;
if(ArrayProto[UNSCOPABLES] == undefined)require('./$.hide')(ArrayProto, UNSCOPABLES, {});
module.exports = function(key){
  ArrayProto[UNSCOPABLES][key] = true;
};
},{"./$.hide":33,"./$.wks":85}],6:[function(require,module,exports){
var isObject = require('./$.is-object');
module.exports = function(it){
  if(!isObject(it))throw TypeError(it + ' is not an object!');
  return it;
};
},{"./$.is-object":40}],7:[function(require,module,exports){
// 22.1.3.3 Array.prototype.copyWithin(target, start, end = this.length)

var toObject = require('./$.to-object')
  , toIndex  = require('./$.to-index')
  , toLength = require('./$.to-length');

module.exports = [].copyWithin || function copyWithin(target/*= 0*/, start/*= 0, end = @length*/){
  var O     = toObject(this)
    , len   = toLength(O.length)
    , to    = toIndex(target, len)
    , from  = toIndex(start, len)
    , $$    = arguments
    , end   = $$.length > 2 ? $$[2] : undefined
    , count = Math.min((end === undefined ? len : toIndex(end, len)) - from, len - to)
    , inc   = 1;
  if(from < to && to < from + count){
    inc  = -1;
    from += count - 1;
    to   += count - 1;
  }
  while(count-- > 0){
    if(from in O)O[to] = O[from];
    else delete O[to];
    to   += inc;
    from += inc;
  } return O;
};
},{"./$.to-index":78,"./$.to-length":81,"./$.to-object":82}],8:[function(require,module,exports){
// 22.1.3.6 Array.prototype.fill(value, start = 0, end = this.length)

var toObject = require('./$.to-object')
  , toIndex  = require('./$.to-index')
  , toLength = require('./$.to-length');
module.exports = [].fill || function fill(value /*, start = 0, end = @length */){
  var O      = toObject(this)
    , length = toLength(O.length)
    , $$     = arguments
    , $$len  = $$.length
    , index  = toIndex($$len > 1 ? $$[1] : undefined, length)
    , end    = $$len > 2 ? $$[2] : undefined
    , endPos = end === undefined ? length : toIndex(end, length);
  while(endPos > index)O[index++] = value;
  return O;
};
},{"./$.to-index":78,"./$.to-length":81,"./$.to-object":82}],9:[function(require,module,exports){
// false -> Array#indexOf
// true  -> Array#includes
var toIObject = require('./$.to-iobject')
  , toLength  = require('./$.to-length')
  , toIndex   = require('./$.to-index');
module.exports = function(IS_INCLUDES){
  return function($this, el, fromIndex){
    var O      = toIObject($this)
      , length = toLength(O.length)
      , index  = toIndex(fromIndex, length)
      , value;
    // Array#includes uses SameValueZero equality algorithm
    if(IS_INCLUDES && el != el)while(length > index){
      value = O[index++];
      if(value != value)return true;
    // Array#toIndex ignores holes, Array#includes - not
    } else for(;length > index; index++)if(IS_INCLUDES || index in O){
      if(O[index] === el)return IS_INCLUDES || index;
    } return !IS_INCLUDES && -1;
  };
};
},{"./$.to-index":78,"./$.to-iobject":80,"./$.to-length":81}],10:[function(require,module,exports){
// 0 -> Array#forEach
// 1 -> Array#map
// 2 -> Array#filter
// 3 -> Array#some
// 4 -> Array#every
// 5 -> Array#find
// 6 -> Array#findIndex
var ctx      = require('./$.ctx')
  , IObject  = require('./$.iobject')
  , toObject = require('./$.to-object')
  , toLength = require('./$.to-length')
  , asc      = require('./$.array-species-create');
module.exports = function(TYPE){
  var IS_MAP        = TYPE == 1
    , IS_FILTER     = TYPE == 2
    , IS_SOME       = TYPE == 3
    , IS_EVERY      = TYPE == 4
    , IS_FIND_INDEX = TYPE == 6
    , NO_HOLES      = TYPE == 5 || IS_FIND_INDEX;
  return function($this, callbackfn, that){
    var O      = toObject($this)
      , self   = IObject(O)
      , f      = ctx(callbackfn, that, 3)
      , length = toLength(self.length)
      , index  = 0
      , result = IS_MAP ? asc($this, length) : IS_FILTER ? asc($this, 0) : undefined
      , val, res;
    for(;length > index; index++)if(NO_HOLES || index in self){
      val = self[index];
      res = f(val, index, O);
      if(TYPE){
        if(IS_MAP)result[index] = res;            // map
        else if(res)switch(TYPE){
          case 3: return true;                    // some
          case 5: return val;                     // find
          case 6: return index;                   // findIndex
          case 2: result.push(val);               // filter
        } else if(IS_EVERY)return false;          // every
      }
    }
    return IS_FIND_INDEX ? -1 : IS_SOME || IS_EVERY ? IS_EVERY : result;
  };
};
},{"./$.array-species-create":11,"./$.ctx":19,"./$.iobject":36,"./$.to-length":81,"./$.to-object":82}],11:[function(require,module,exports){
// 9.4.2.3 ArraySpeciesCreate(originalArray, length)
var isObject = require('./$.is-object')
  , isArray  = require('./$.is-array')
  , SPECIES  = require('./$.wks')('species');
module.exports = function(original, length){
  var C;
  if(isArray(original)){
    C = original.constructor;
    // cross-realm fallback
    if(typeof C == 'function' && (C === Array || isArray(C.prototype)))C = undefined;
    if(isObject(C)){
      C = C[SPECIES];
      if(C === null)C = undefined;
    }
  } return new (C === undefined ? Array : C)(length);
};
},{"./$.is-array":38,"./$.is-object":40,"./$.wks":85}],12:[function(require,module,exports){
// getting tag from 19.1.3.6 Object.prototype.toString()
var cof = require('./$.cof')
  , TAG = require('./$.wks')('toStringTag')
  // ES3 wrong here
  , ARG = cof(function(){ return arguments; }()) == 'Arguments';

module.exports = function(it){
  var O, T, B;
  return it === undefined ? 'Undefined' : it === null ? 'Null'
    // @@toStringTag case
    : typeof (T = (O = Object(it))[TAG]) == 'string' ? T
    // builtinTag case
    : ARG ? cof(O)
    // ES3 arguments fallback
    : (B = cof(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : B;
};
},{"./$.cof":13,"./$.wks":85}],13:[function(require,module,exports){
var toString = {}.toString;

module.exports = function(it){
  return toString.call(it).slice(8, -1);
};
},{}],14:[function(require,module,exports){

var $            = require('./$')
  , hide         = require('./$.hide')
  , redefineAll  = require('./$.redefine-all')
  , ctx          = require('./$.ctx')
  , strictNew    = require('./$.strict-new')
  , defined      = require('./$.defined')
  , forOf        = require('./$.for-of')
  , $iterDefine  = require('./$.iter-define')
  , step         = require('./$.iter-step')
  , ID           = require('./$.uid')('id')
  , $has         = require('./$.has')
  , isObject     = require('./$.is-object')
  , setSpecies   = require('./$.set-species')
  , DESCRIPTORS  = require('./$.descriptors')
  , isExtensible = Object.isExtensible || isObject
  , SIZE         = DESCRIPTORS ? '_s' : 'size'
  , id           = 0;

var fastKey = function(it, create){
  // return primitive with prefix
  if(!isObject(it))return typeof it == 'symbol' ? it : (typeof it == 'string' ? 'S' : 'P') + it;
  if(!$has(it, ID)){
    // can't set id to frozen object
    if(!isExtensible(it))return 'F';
    // not necessary to add id
    if(!create)return 'E';
    // add missing object id
    hide(it, ID, ++id);
  // return object id with prefix
  } return 'O' + it[ID];
};

var getEntry = function(that, key){
  // fast case
  var index = fastKey(key), entry;
  if(index !== 'F')return that._i[index];
  // frozen object case
  for(entry = that._f; entry; entry = entry.n){
    if(entry.k == key)return entry;
  }
};

module.exports = {
  getConstructor: function(wrapper, NAME, IS_MAP, ADDER){
    var C = wrapper(function(that, iterable){
      strictNew(that, C, NAME);
      that._i = $.create(null); // index
      that._f = undefined;      // first entry
      that._l = undefined;      // last entry
      that[SIZE] = 0;           // size
      if(iterable != undefined)forOf(iterable, IS_MAP, that[ADDER], that);
    });
    redefineAll(C.prototype, {
      // 23.1.3.1 Map.prototype.clear()
      // 23.2.3.2 Set.prototype.clear()
      clear: function clear(){
        for(var that = this, data = that._i, entry = that._f; entry; entry = entry.n){
          entry.r = true;
          if(entry.p)entry.p = entry.p.n = undefined;
          delete data[entry.i];
        }
        that._f = that._l = undefined;
        that[SIZE] = 0;
      },
      // 23.1.3.3 Map.prototype.delete(key)
      // 23.2.3.4 Set.prototype.delete(value)
      'delete': function(key){
        var that  = this
          , entry = getEntry(that, key);
        if(entry){
          var next = entry.n
            , prev = entry.p;
          delete that._i[entry.i];
          entry.r = true;
          if(prev)prev.n = next;
          if(next)next.p = prev;
          if(that._f == entry)that._f = next;
          if(that._l == entry)that._l = prev;
          that[SIZE]--;
        } return !!entry;
      },
      // 23.2.3.6 Set.prototype.forEach(callbackfn, thisArg = undefined)
      // 23.1.3.5 Map.prototype.forEach(callbackfn, thisArg = undefined)
      forEach: function forEach(callbackfn /*, that = undefined */){
        var f = ctx(callbackfn, arguments.length > 1 ? arguments[1] : undefined, 3)
          , entry;
        while(entry = entry ? entry.n : this._f){
          f(entry.v, entry.k, this);
          // revert to the last existing entry
          while(entry && entry.r)entry = entry.p;
        }
      },
      // 23.1.3.7 Map.prototype.has(key)
      // 23.2.3.7 Set.prototype.has(value)
      has: function has(key){
        return !!getEntry(this, key);
      }
    });
    if(DESCRIPTORS)$.setDesc(C.prototype, 'size', {
      get: function(){
        return defined(this[SIZE]);
      }
    });
    return C;
  },
  def: function(that, key, value){
    var entry = getEntry(that, key)
      , prev, index;
    // change existing entry
    if(entry){
      entry.v = value;
    // create new entry
    } else {
      that._l = entry = {
        i: index = fastKey(key, true), // <- index
        k: key,                        // <- key
        v: value,                      // <- value
        p: prev = that._l,             // <- previous entry
        n: undefined,                  // <- next entry
        r: false                       // <- removed
      };
      if(!that._f)that._f = entry;
      if(prev)prev.n = entry;
      that[SIZE]++;
      // add to index
      if(index !== 'F')that._i[index] = entry;
    } return that;
  },
  getEntry: getEntry,
  setStrong: function(C, NAME, IS_MAP){
    // add .keys, .values, .entries, [@@iterator]
    // 23.1.3.4, 23.1.3.8, 23.1.3.11, 23.1.3.12, 23.2.3.5, 23.2.3.8, 23.2.3.10, 23.2.3.11
    $iterDefine(C, NAME, function(iterated, kind){
      this._t = iterated;  // target
      this._k = kind;      // kind
      this._l = undefined; // previous
    }, function(){
      var that  = this
        , kind  = that._k
        , entry = that._l;
      // revert to the last existing entry
      while(entry && entry.r)entry = entry.p;
      // get next entry
      if(!that._t || !(that._l = entry = entry ? entry.n : that._t._f)){
        // or finish the iteration
        that._t = undefined;
        return step(1);
      }
      // return step by kind
      if(kind == 'keys'  )return step(0, entry.k);
      if(kind == 'values')return step(0, entry.v);
      return step(0, [entry.k, entry.v]);
    }, IS_MAP ? 'entries' : 'values' , !IS_MAP, true);

    // add [@@species], 23.1.2.2, 23.2.2.2
    setSpecies(NAME);
  }
};
},{"./$":48,"./$.ctx":19,"./$.defined":20,"./$.descriptors":21,"./$.for-of":29,"./$.has":32,"./$.hide":33,"./$.is-object":40,"./$.iter-define":44,"./$.iter-step":46,"./$.redefine-all":62,"./$.set-species":67,"./$.strict-new":71,"./$.uid":84}],15:[function(require,module,exports){
// https://github.com/DavidBruant/Map-Set.prototype.toJSON
var forOf   = require('./$.for-of')
  , classof = require('./$.classof');
module.exports = function(NAME){
  return function toJSON(){
    if(classof(this) != NAME)throw TypeError(NAME + "#toJSON isn't generic");
    var arr = [];
    forOf(this, false, arr.push, arr);
    return arr;
  };
};
},{"./$.classof":12,"./$.for-of":29}],16:[function(require,module,exports){

var hide              = require('./$.hide')
  , redefineAll       = require('./$.redefine-all')
  , anObject          = require('./$.an-object')
  , isObject          = require('./$.is-object')
  , strictNew         = require('./$.strict-new')
  , forOf             = require('./$.for-of')
  , createArrayMethod = require('./$.array-methods')
  , $has              = require('./$.has')
  , WEAK              = require('./$.uid')('weak')
  , isExtensible      = Object.isExtensible || isObject
  , arrayFind         = createArrayMethod(5)
  , arrayFindIndex    = createArrayMethod(6)
  , id                = 0;

// fallback for frozen keys
var frozenStore = function(that){
  return that._l || (that._l = new FrozenStore);
};
var FrozenStore = function(){
  this.a = [];
};
var findFrozen = function(store, key){
  return arrayFind(store.a, function(it){
    return it[0] === key;
  });
};
FrozenStore.prototype = {
  get: function(key){
    var entry = findFrozen(this, key);
    if(entry)return entry[1];
  },
  has: function(key){
    return !!findFrozen(this, key);
  },
  set: function(key, value){
    var entry = findFrozen(this, key);
    if(entry)entry[1] = value;
    else this.a.push([key, value]);
  },
  'delete': function(key){
    var index = arrayFindIndex(this.a, function(it){
      return it[0] === key;
    });
    if(~index)this.a.splice(index, 1);
    return !!~index;
  }
};

module.exports = {
  getConstructor: function(wrapper, NAME, IS_MAP, ADDER){
    var C = wrapper(function(that, iterable){
      strictNew(that, C, NAME);
      that._i = id++;      // collection id
      that._l = undefined; // leak store for frozen objects
      if(iterable != undefined)forOf(iterable, IS_MAP, that[ADDER], that);
    });
    redefineAll(C.prototype, {
      // 23.3.3.2 WeakMap.prototype.delete(key)
      // 23.4.3.3 WeakSet.prototype.delete(value)
      'delete': function(key){
        if(!isObject(key))return false;
        if(!isExtensible(key))return frozenStore(this)['delete'](key);
        return $has(key, WEAK) && $has(key[WEAK], this._i) && delete key[WEAK][this._i];
      },
      // 23.3.3.4 WeakMap.prototype.has(key)
      // 23.4.3.4 WeakSet.prototype.has(value)
      has: function has(key){
        if(!isObject(key))return false;
        if(!isExtensible(key))return frozenStore(this).has(key);
        return $has(key, WEAK) && $has(key[WEAK], this._i);
      }
    });
    return C;
  },
  def: function(that, key, value){
    if(!isExtensible(anObject(key))){
      frozenStore(that).set(key, value);
    } else {
      $has(key, WEAK) || hide(key, WEAK, {});
      key[WEAK][that._i] = value;
    } return that;
  },
  frozenStore: frozenStore,
  WEAK: WEAK
};
},{"./$.an-object":6,"./$.array-methods":10,"./$.for-of":29,"./$.has":32,"./$.hide":33,"./$.is-object":40,"./$.redefine-all":62,"./$.strict-new":71,"./$.uid":84}],17:[function(require,module,exports){

var global         = require('./$.global')
  , $export        = require('./$.export')
  , redefine       = require('./$.redefine')
  , redefineAll    = require('./$.redefine-all')
  , forOf          = require('./$.for-of')
  , strictNew      = require('./$.strict-new')
  , isObject       = require('./$.is-object')
  , fails          = require('./$.fails')
  , $iterDetect    = require('./$.iter-detect')
  , setToStringTag = require('./$.set-to-string-tag');

module.exports = function(NAME, wrapper, methods, common, IS_MAP, IS_WEAK){
  var Base  = global[NAME]
    , C     = Base
    , ADDER = IS_MAP ? 'set' : 'add'
    , proto = C && C.prototype
    , O     = {};
  var fixMethod = function(KEY){
    var fn = proto[KEY];
    redefine(proto, KEY,
      KEY == 'delete' ? function(a){
        return IS_WEAK && !isObject(a) ? false : fn.call(this, a === 0 ? 0 : a);
      } : KEY == 'has' ? function has(a){
        return IS_WEAK && !isObject(a) ? false : fn.call(this, a === 0 ? 0 : a);
      } : KEY == 'get' ? function get(a){
        return IS_WEAK && !isObject(a) ? undefined : fn.call(this, a === 0 ? 0 : a);
      } : KEY == 'add' ? function add(a){ fn.call(this, a === 0 ? 0 : a); return this; }
        : function set(a, b){ fn.call(this, a === 0 ? 0 : a, b); return this; }
    );
  };
  if(typeof C != 'function' || !(IS_WEAK || proto.forEach && !fails(function(){
    new C().entries().next();
  }))){
    // create collection constructor
    C = common.getConstructor(wrapper, NAME, IS_MAP, ADDER);
    redefineAll(C.prototype, methods);
  } else {
    var instance             = new C
      // early implementations not supports chaining
      , HASNT_CHAINING       = instance[ADDER](IS_WEAK ? {} : -0, 1) != instance
      // V8 ~  Chromium 40- weak-collections throws on primitives, but should return false
      , THROWS_ON_PRIMITIVES = fails(function(){ instance.has(1); })
      // most early implementations doesn't supports iterables, most modern - not close it correctly
      , ACCEPT_ITERABLES     = $iterDetect(function(iter){ new C(iter); }) // eslint-disable-line no-new
      // for early implementations -0 and +0 not the same
      , BUGGY_ZERO;
    if(!ACCEPT_ITERABLES){ 
      C = wrapper(function(target, iterable){
        strictNew(target, C, NAME);
        var that = new Base;
        if(iterable != undefined)forOf(iterable, IS_MAP, that[ADDER], that);
        return that;
      });
      C.prototype = proto;
      proto.constructor = C;
    }
    IS_WEAK || instance.forEach(function(val, key){
      BUGGY_ZERO = 1 / key === -Infinity;
    });
    if(THROWS_ON_PRIMITIVES || BUGGY_ZERO){
      fixMethod('delete');
      fixMethod('has');
      IS_MAP && fixMethod('get');
    }
    if(BUGGY_ZERO || HASNT_CHAINING)fixMethod(ADDER);
    // weak collections should not contains .clear method
    if(IS_WEAK && proto.clear)delete proto.clear;
  }

  setToStringTag(C, NAME);

  O[NAME] = C;
  $export($export.G + $export.W + $export.F * (C != Base), O);

  if(!IS_WEAK)common.setStrong(C, NAME, IS_MAP);

  return C;
};
},{"./$.export":24,"./$.fails":26,"./$.for-of":29,"./$.global":31,"./$.is-object":40,"./$.iter-detect":45,"./$.redefine":63,"./$.redefine-all":62,"./$.set-to-string-tag":68,"./$.strict-new":71}],18:[function(require,module,exports){
var core = module.exports = {version: '1.2.6'};
if(typeof __e == 'number')__e = core; // eslint-disable-line no-undef
},{}],19:[function(require,module,exports){
// optional / simple context binding
var aFunction = require('./$.a-function');
module.exports = function(fn, that, length){
  aFunction(fn);
  if(that === undefined)return fn;
  switch(length){
    case 1: return function(a){
      return fn.call(that, a);
    };
    case 2: return function(a, b){
      return fn.call(that, a, b);
    };
    case 3: return function(a, b, c){
      return fn.call(that, a, b, c);
    };
  }
  return function(/* ...args */){
    return fn.apply(that, arguments);
  };
};
},{"./$.a-function":4}],20:[function(require,module,exports){
// 7.2.1 RequireObjectCoercible(argument)
module.exports = function(it){
  if(it == undefined)throw TypeError("Can't call method on  " + it);
  return it;
};
},{}],21:[function(require,module,exports){
// Thank's IE8 for his funny defineProperty
module.exports = !require('./$.fails')(function(){
  return Object.defineProperty({}, 'a', {get: function(){ return 7; }}).a != 7;
});
},{"./$.fails":26}],22:[function(require,module,exports){
var isObject = require('./$.is-object')
  , document = require('./$.global').document
  // in old IE typeof document.createElement is 'object'
  , is = isObject(document) && isObject(document.createElement);
module.exports = function(it){
  return is ? document.createElement(it) : {};
};
},{"./$.global":31,"./$.is-object":40}],23:[function(require,module,exports){
// all enumerable object keys, includes symbols
var $ = require('./$');
module.exports = function(it){
  var keys       = $.getKeys(it)
    , getSymbols = $.getSymbols;
  if(getSymbols){
    var symbols = getSymbols(it)
      , isEnum  = $.isEnum
      , i       = 0
      , key;
    while(symbols.length > i)if(isEnum.call(it, key = symbols[i++]))keys.push(key);
  }
  return keys;
};
},{"./$":48}],24:[function(require,module,exports){
var global    = require('./$.global')
  , core      = require('./$.core')
  , hide      = require('./$.hide')
  , redefine  = require('./$.redefine')
  , ctx       = require('./$.ctx')
  , PROTOTYPE = 'prototype';

var $export = function(type, name, source){
  var IS_FORCED = type & $export.F
    , IS_GLOBAL = type & $export.G
    , IS_STATIC = type & $export.S
    , IS_PROTO  = type & $export.P
    , IS_BIND   = type & $export.B
    , target    = IS_GLOBAL ? global : IS_STATIC ? global[name] || (global[name] = {}) : (global[name] || {})[PROTOTYPE]
    , exports   = IS_GLOBAL ? core : core[name] || (core[name] = {})
    , expProto  = exports[PROTOTYPE] || (exports[PROTOTYPE] = {})
    , key, own, out, exp;
  if(IS_GLOBAL)source = name;
  for(key in source){
    // contains in native
    own = !IS_FORCED && target && key in target;
    // export native or passed
    out = (own ? target : source)[key];
    // bind timers to global for call from export context
    exp = IS_BIND && own ? ctx(out, global) : IS_PROTO && typeof out == 'function' ? ctx(Function.call, out) : out;
    // extend global
    if(target && !own)redefine(target, key, out);
    // export
    if(exports[key] != out)hide(exports, key, exp);
    if(IS_PROTO && expProto[key] != out)expProto[key] = out;
  }
};
global.core = core;
// type bitmap
$export.F = 1;  // forced
$export.G = 2;  // global
$export.S = 4;  // static
$export.P = 8;  // proto
$export.B = 16; // bind
$export.W = 32; // wrap
module.exports = $export;
},{"./$.core":18,"./$.ctx":19,"./$.global":31,"./$.hide":33,"./$.redefine":63}],25:[function(require,module,exports){
var MATCH = require('./$.wks')('match');
module.exports = function(KEY){
  var re = /./;
  try {
    '/./'[KEY](re);
  } catch(e){
    try {
      re[MATCH] = false;
      return !'/./'[KEY](re);
    } catch(f){ /* empty */ }
  } return true;
};
},{"./$.wks":85}],26:[function(require,module,exports){
module.exports = function(exec){
  try {
    return !!exec();
  } catch(e){
    return true;
  }
};
},{}],27:[function(require,module,exports){

var hide     = require('./$.hide')
  , redefine = require('./$.redefine')
  , fails    = require('./$.fails')
  , defined  = require('./$.defined')
  , wks      = require('./$.wks');

module.exports = function(KEY, length, exec){
  var SYMBOL   = wks(KEY)
    , original = ''[KEY];
  if(fails(function(){
    var O = {};
    O[SYMBOL] = function(){ return 7; };
    return ''[KEY](O) != 7;
  })){
    redefine(String.prototype, KEY, exec(defined, SYMBOL, original));
    hide(RegExp.prototype, SYMBOL, length == 2
      // 21.2.5.8 RegExp.prototype[@@replace](string, replaceValue)
      // 21.2.5.11 RegExp.prototype[@@split](string, limit)
      ? function(string, arg){ return original.call(string, this, arg); }
      // 21.2.5.6 RegExp.prototype[@@match](string)
      // 21.2.5.9 RegExp.prototype[@@search](string)
      : function(string){ return original.call(string, this); }
    );
  }
};
},{"./$.defined":20,"./$.fails":26,"./$.hide":33,"./$.redefine":63,"./$.wks":85}],28:[function(require,module,exports){

// 21.2.5.3 get RegExp.prototype.flags
var anObject = require('./$.an-object');
module.exports = function(){
  var that   = anObject(this)
    , result = '';
  if(that.global)     result += 'g';
  if(that.ignoreCase) result += 'i';
  if(that.multiline)  result += 'm';
  if(that.unicode)    result += 'u';
  if(that.sticky)     result += 'y';
  return result;
};
},{"./$.an-object":6}],29:[function(require,module,exports){
var ctx         = require('./$.ctx')
  , call        = require('./$.iter-call')
  , isArrayIter = require('./$.is-array-iter')
  , anObject    = require('./$.an-object')
  , toLength    = require('./$.to-length')
  , getIterFn   = require('./core.get-iterator-method');
module.exports = function(iterable, entries, fn, that){
  var iterFn = getIterFn(iterable)
    , f      = ctx(fn, that, entries ? 2 : 1)
    , index  = 0
    , length, step, iterator;
  if(typeof iterFn != 'function')throw TypeError(iterable + ' is not iterable!');
  // fast case for arrays with default iterator
  if(isArrayIter(iterFn))for(length = toLength(iterable.length); length > index; index++){
    entries ? f(anObject(step = iterable[index])[0], step[1]) : f(iterable[index]);
  } else for(iterator = iterFn.call(iterable); !(step = iterator.next()).done; ){
    call(iterator, f, step.value, entries);
  }
};
},{"./$.an-object":6,"./$.ctx":19,"./$.is-array-iter":37,"./$.iter-call":42,"./$.to-length":81,"./core.get-iterator-method":86}],30:[function(require,module,exports){
// fallback for IE11 buggy Object.getOwnPropertyNames with iframe and window
var toIObject = require('./$.to-iobject')
  , getNames  = require('./$').getNames
  , toString  = {}.toString;

var windowNames = typeof window == 'object' && Object.getOwnPropertyNames
  ? Object.getOwnPropertyNames(window) : [];

var getWindowNames = function(it){
  try {
    return getNames(it);
  } catch(e){
    return windowNames.slice();
  }
};

module.exports.get = function getOwnPropertyNames(it){
  if(windowNames && toString.call(it) == '[object Window]')return getWindowNames(it);
  return getNames(toIObject(it));
};
},{"./$":48,"./$.to-iobject":80}],31:[function(require,module,exports){
// https://github.com/zloirock/core-js/issues/86#issuecomment-115759028
var global = module.exports = typeof window != 'undefined' && window.Math == Math
  ? window : typeof self != 'undefined' && self.Math == Math ? self : Function('return this')();
if(typeof __g == 'number')__g = global; // eslint-disable-line no-undef
},{}],32:[function(require,module,exports){
var hasOwnProperty = {}.hasOwnProperty;
module.exports = function(it, key){
  return hasOwnProperty.call(it, key);
};
},{}],33:[function(require,module,exports){
var $          = require('./$')
  , createDesc = require('./$.property-desc');
module.exports = require('./$.descriptors') ? function(object, key, value){
  return $.setDesc(object, key, createDesc(1, value));
} : function(object, key, value){
  object[key] = value;
  return object;
};
},{"./$":48,"./$.descriptors":21,"./$.property-desc":61}],34:[function(require,module,exports){
module.exports = require('./$.global').document && document.documentElement;
},{"./$.global":31}],35:[function(require,module,exports){
// fast apply, http://jsperf.lnkit.com/fast-apply/5
module.exports = function(fn, args, that){
  var un = that === undefined;
  switch(args.length){
    case 0: return un ? fn()
                      : fn.call(that);
    case 1: return un ? fn(args[0])
                      : fn.call(that, args[0]);
    case 2: return un ? fn(args[0], args[1])
                      : fn.call(that, args[0], args[1]);
    case 3: return un ? fn(args[0], args[1], args[2])
                      : fn.call(that, args[0], args[1], args[2]);
    case 4: return un ? fn(args[0], args[1], args[2], args[3])
                      : fn.call(that, args[0], args[1], args[2], args[3]);
  } return              fn.apply(that, args);
};
},{}],36:[function(require,module,exports){
// fallback for non-array-like ES3 and non-enumerable old V8 strings
var cof = require('./$.cof');
module.exports = Object('z').propertyIsEnumerable(0) ? Object : function(it){
  return cof(it) == 'String' ? it.split('') : Object(it);
};
},{"./$.cof":13}],37:[function(require,module,exports){
// check on default Array iterator
var Iterators  = require('./$.iterators')
  , ITERATOR   = require('./$.wks')('iterator')
  , ArrayProto = Array.prototype;

module.exports = function(it){
  return it !== undefined && (Iterators.Array === it || ArrayProto[ITERATOR] === it);
};
},{"./$.iterators":47,"./$.wks":85}],38:[function(require,module,exports){
// 7.2.2 IsArray(argument)
var cof = require('./$.cof');
module.exports = Array.isArray || function(arg){
  return cof(arg) == 'Array';
};
},{"./$.cof":13}],39:[function(require,module,exports){
// 20.1.2.3 Number.isInteger(number)
var isObject = require('./$.is-object')
  , floor    = Math.floor;
module.exports = function isInteger(it){
  return !isObject(it) && isFinite(it) && floor(it) === it;
};
},{"./$.is-object":40}],40:[function(require,module,exports){
module.exports = function(it){
  return typeof it === 'object' ? it !== null : typeof it === 'function';
};
},{}],41:[function(require,module,exports){
// 7.2.8 IsRegExp(argument)
var isObject = require('./$.is-object')
  , cof      = require('./$.cof')
  , MATCH    = require('./$.wks')('match');
module.exports = function(it){
  var isRegExp;
  return isObject(it) && ((isRegExp = it[MATCH]) !== undefined ? !!isRegExp : cof(it) == 'RegExp');
};
},{"./$.cof":13,"./$.is-object":40,"./$.wks":85}],42:[function(require,module,exports){
// call something on iterator step with safe closing on error
var anObject = require('./$.an-object');
module.exports = function(iterator, fn, value, entries){
  try {
    return entries ? fn(anObject(value)[0], value[1]) : fn(value);
  // 7.4.6 IteratorClose(iterator, completion)
  } catch(e){
    var ret = iterator['return'];
    if(ret !== undefined)anObject(ret.call(iterator));
    throw e;
  }
};
},{"./$.an-object":6}],43:[function(require,module,exports){

var $              = require('./$')
  , descriptor     = require('./$.property-desc')
  , setToStringTag = require('./$.set-to-string-tag')
  , IteratorPrototype = {};

// 25.1.2.1.1 %IteratorPrototype%[@@iterator]()
require('./$.hide')(IteratorPrototype, require('./$.wks')('iterator'), function(){ return this; });

module.exports = function(Constructor, NAME, next){
  Constructor.prototype = $.create(IteratorPrototype, {next: descriptor(1, next)});
  setToStringTag(Constructor, NAME + ' Iterator');
};
},{"./$":48,"./$.hide":33,"./$.property-desc":61,"./$.set-to-string-tag":68,"./$.wks":85}],44:[function(require,module,exports){

var LIBRARY        = require('./$.library')
  , $export        = require('./$.export')
  , redefine       = require('./$.redefine')
  , hide           = require('./$.hide')
  , has            = require('./$.has')
  , Iterators      = require('./$.iterators')
  , $iterCreate    = require('./$.iter-create')
  , setToStringTag = require('./$.set-to-string-tag')
  , getProto       = require('./$').getProto
  , ITERATOR       = require('./$.wks')('iterator')
  , BUGGY          = !([].keys && 'next' in [].keys()) // Safari has buggy iterators w/o `next`
  , FF_ITERATOR    = '@@iterator'
  , KEYS           = 'keys'
  , VALUES         = 'values';

var returnThis = function(){ return this; };

module.exports = function(Base, NAME, Constructor, next, DEFAULT, IS_SET, FORCED){
  $iterCreate(Constructor, NAME, next);
  var getMethod = function(kind){
    if(!BUGGY && kind in proto)return proto[kind];
    switch(kind){
      case KEYS: return function keys(){ return new Constructor(this, kind); };
      case VALUES: return function values(){ return new Constructor(this, kind); };
    } return function entries(){ return new Constructor(this, kind); };
  };
  var TAG        = NAME + ' Iterator'
    , DEF_VALUES = DEFAULT == VALUES
    , VALUES_BUG = false
    , proto      = Base.prototype
    , $native    = proto[ITERATOR] || proto[FF_ITERATOR] || DEFAULT && proto[DEFAULT]
    , $default   = $native || getMethod(DEFAULT)
    , methods, key;
  // Fix native
  if($native){
    var IteratorPrototype = getProto($default.call(new Base));
    // Set @@toStringTag to native iterators
    setToStringTag(IteratorPrototype, TAG, true);
    // FF fix
    if(!LIBRARY && has(proto, FF_ITERATOR))hide(IteratorPrototype, ITERATOR, returnThis);
    // fix Array#{values, @@iterator}.name in V8 / FF
    if(DEF_VALUES && $native.name !== VALUES){
      VALUES_BUG = true;
      $default = function values(){ return $native.call(this); };
    }
  }
  // Define iterator
  if((!LIBRARY || FORCED) && (BUGGY || VALUES_BUG || !proto[ITERATOR])){
    hide(proto, ITERATOR, $default);
  }
  // Plug for library
  Iterators[NAME] = $default;
  Iterators[TAG]  = returnThis;
  if(DEFAULT){
    methods = {
      values:  DEF_VALUES  ? $default : getMethod(VALUES),
      keys:    IS_SET      ? $default : getMethod(KEYS),
      entries: !DEF_VALUES ? $default : getMethod('entries')
    };
    if(FORCED)for(key in methods){
      if(!(key in proto))redefine(proto, key, methods[key]);
    } else $export($export.P + $export.F * (BUGGY || VALUES_BUG), NAME, methods);
  }
  return methods;
};
},{"./$":48,"./$.export":24,"./$.has":32,"./$.hide":33,"./$.iter-create":43,"./$.iterators":47,"./$.library":50,"./$.redefine":63,"./$.set-to-string-tag":68,"./$.wks":85}],45:[function(require,module,exports){
var ITERATOR     = require('./$.wks')('iterator')
  , SAFE_CLOSING = false;

try {
  var riter = [7][ITERATOR]();
  riter['return'] = function(){ SAFE_CLOSING = true; };
  Array.from(riter, function(){ throw 2; });
} catch(e){ /* empty */ }

module.exports = function(exec, skipClosing){
  if(!skipClosing && !SAFE_CLOSING)return false;
  var safe = false;
  try {
    var arr  = [7]
      , iter = arr[ITERATOR]();
    iter.next = function(){ safe = true; };
    arr[ITERATOR] = function(){ return iter; };
    exec(arr);
  } catch(e){ /* empty */ }
  return safe;
};
},{"./$.wks":85}],46:[function(require,module,exports){
module.exports = function(done, value){
  return {value: value, done: !!done};
};
},{}],47:[function(require,module,exports){
module.exports = {};
},{}],48:[function(require,module,exports){
var $Object = Object;
module.exports = {
  create:     $Object.create,
  getProto:   $Object.getPrototypeOf,
  isEnum:     {}.propertyIsEnumerable,
  getDesc:    $Object.getOwnPropertyDescriptor,
  setDesc:    $Object.defineProperty,
  setDescs:   $Object.defineProperties,
  getKeys:    $Object.keys,
  getNames:   $Object.getOwnPropertyNames,
  getSymbols: $Object.getOwnPropertySymbols,
  each:       [].forEach
};
},{}],49:[function(require,module,exports){
var $         = require('./$')
  , toIObject = require('./$.to-iobject');
module.exports = function(object, el){
  var O      = toIObject(object)
    , keys   = $.getKeys(O)
    , length = keys.length
    , index  = 0
    , key;
  while(length > index)if(O[key = keys[index++]] === el)return key;
};
},{"./$":48,"./$.to-iobject":80}],50:[function(require,module,exports){
module.exports = false;
},{}],51:[function(require,module,exports){
// 20.2.2.14 Math.expm1(x)
module.exports = Math.expm1 || function expm1(x){
  return (x = +x) == 0 ? x : x > -1e-6 && x < 1e-6 ? x + x * x / 2 : Math.exp(x) - 1;
};
},{}],52:[function(require,module,exports){
// 20.2.2.20 Math.log1p(x)
module.exports = Math.log1p || function log1p(x){
  return (x = +x) > -1e-8 && x < 1e-8 ? x - x * x / 2 : Math.log(1 + x);
};
},{}],53:[function(require,module,exports){
// 20.2.2.28 Math.sign(x)
module.exports = Math.sign || function sign(x){
  return (x = +x) == 0 || x != x ? x : x < 0 ? -1 : 1;
};
},{}],54:[function(require,module,exports){
var global    = require('./$.global')
  , macrotask = require('./$.task').set
  , Observer  = global.MutationObserver || global.WebKitMutationObserver
  , process   = global.process
  , Promise   = global.Promise
  , isNode    = require('./$.cof')(process) == 'process'
  , head, last, notify;

var flush = function(){
  var parent, domain, fn;
  if(isNode && (parent = process.domain)){
    process.domain = null;
    parent.exit();
  }
  while(head){
    domain = head.domain;
    fn     = head.fn;
    if(domain)domain.enter();
    fn(); // <- currently we use it only for Promise - try / catch not required
    if(domain)domain.exit();
    head = head.next;
  } last = undefined;
  if(parent)parent.enter();
};

// Node.js
if(isNode){
  notify = function(){
    process.nextTick(flush);
  };
// browsers with MutationObserver
} else if(Observer){
  var toggle = 1
    , node   = document.createTextNode('');
  new Observer(flush).observe(node, {characterData: true}); // eslint-disable-line no-new
  notify = function(){
    node.data = toggle = -toggle;
  };
// environments with maybe non-completely correct, but existent Promise
} else if(Promise && Promise.resolve){
  notify = function(){
    Promise.resolve().then(flush);
  };
// for other environments - macrotask based on:
// - setImmediate
// - MessageChannel
// - window.postMessag
// - onreadystatechange
// - setTimeout
} else {
  notify = function(){
    // strange IE + webpack dev server bug - use .call(global)
    macrotask.call(global, flush);
  };
}

module.exports = function asap(fn){
  var task = {fn: fn, next: undefined, domain: isNode && process.domain};
  if(last)last.next = task;
  if(!head){
    head = task;
    notify();
  } last = task;
};
},{"./$.cof":13,"./$.global":31,"./$.task":77}],55:[function(require,module,exports){
// 19.1.2.1 Object.assign(target, source, ...)
var $        = require('./$')
  , toObject = require('./$.to-object')
  , IObject  = require('./$.iobject');

// should work with symbols and should have deterministic property order (V8 bug)
module.exports = require('./$.fails')(function(){
  var a = Object.assign
    , A = {}
    , B = {}
    , S = Symbol()
    , K = 'abcdefghijklmnopqrst';
  A[S] = 7;
  K.split('').forEach(function(k){ B[k] = k; });
  return a({}, A)[S] != 7 || Object.keys(a({}, B)).join('') != K;
}) ? function assign(target, source){ // eslint-disable-line no-unused-vars
  var T     = toObject(target)
    , $$    = arguments
    , $$len = $$.length
    , index = 1
    , getKeys    = $.getKeys
    , getSymbols = $.getSymbols
    , isEnum     = $.isEnum;
  while($$len > index){
    var S      = IObject($$[index++])
      , keys   = getSymbols ? getKeys(S).concat(getSymbols(S)) : getKeys(S)
      , length = keys.length
      , j      = 0
      , key;
    while(length > j)if(isEnum.call(S, key = keys[j++]))T[key] = S[key];
  }
  return T;
} : Object.assign;
},{"./$":48,"./$.fails":26,"./$.iobject":36,"./$.to-object":82}],56:[function(require,module,exports){
// most Object methods by ES6 should accept primitives
var $export = require('./$.export')
  , core    = require('./$.core')
  , fails   = require('./$.fails');
module.exports = function(KEY, exec){
  var fn  = (core.Object || {})[KEY] || Object[KEY]
    , exp = {};
  exp[KEY] = exec(fn);
  $export($export.S + $export.F * fails(function(){ fn(1); }), 'Object', exp);
};
},{"./$.core":18,"./$.export":24,"./$.fails":26}],57:[function(require,module,exports){
var $         = require('./$')
  , toIObject = require('./$.to-iobject')
  , isEnum    = $.isEnum;
module.exports = function(isEntries){
  return function(it){
    var O      = toIObject(it)
      , keys   = $.getKeys(O)
      , length = keys.length
      , i      = 0
      , result = []
      , key;
    while(length > i)if(isEnum.call(O, key = keys[i++])){
      result.push(isEntries ? [key, O[key]] : O[key]);
    } return result;
  };
};
},{"./$":48,"./$.to-iobject":80}],58:[function(require,module,exports){
// all object keys, includes non-enumerable and symbols
var $        = require('./$')
  , anObject = require('./$.an-object')
  , Reflect  = require('./$.global').Reflect;
module.exports = Reflect && Reflect.ownKeys || function ownKeys(it){
  var keys       = $.getNames(anObject(it))
    , getSymbols = $.getSymbols;
  return getSymbols ? keys.concat(getSymbols(it)) : keys;
};
},{"./$":48,"./$.an-object":6,"./$.global":31}],59:[function(require,module,exports){

var path      = require('./$.path')
  , invoke    = require('./$.invoke')
  , aFunction = require('./$.a-function');
module.exports = function(/* ...pargs */){
  var fn     = aFunction(this)
    , length = arguments.length
    , pargs  = Array(length)
    , i      = 0
    , _      = path._
    , holder = false;
  while(length > i)if((pargs[i] = arguments[i++]) === _)holder = true;
  return function(/* ...args */){
    var that  = this
      , $$    = arguments
      , $$len = $$.length
      , j = 0, k = 0, args;
    if(!holder && !$$len)return invoke(fn, pargs, that);
    args = pargs.slice();
    if(holder)for(;length > j; j++)if(args[j] === _)args[j] = $$[k++];
    while($$len > k)args.push($$[k++]);
    return invoke(fn, args, that);
  };
};
},{"./$.a-function":4,"./$.invoke":35,"./$.path":60}],60:[function(require,module,exports){
module.exports = require('./$.global');
},{"./$.global":31}],61:[function(require,module,exports){
module.exports = function(bitmap, value){
  return {
    enumerable  : !(bitmap & 1),
    configurable: !(bitmap & 2),
    writable    : !(bitmap & 4),
    value       : value
  };
};
},{}],62:[function(require,module,exports){
var redefine = require('./$.redefine');
module.exports = function(target, src){
  for(var key in src)redefine(target, key, src[key]);
  return target;
};
},{"./$.redefine":63}],63:[function(require,module,exports){
// add fake Function#toString
// for correct work wrapped methods / constructors with methods like LoDash isNative
var global    = require('./$.global')
  , hide      = require('./$.hide')
  , SRC       = require('./$.uid')('src')
  , TO_STRING = 'toString'
  , $toString = Function[TO_STRING]
  , TPL       = ('' + $toString).split(TO_STRING);

require('./$.core').inspectSource = function(it){
  return $toString.call(it);
};

(module.exports = function(O, key, val, safe){
  if(typeof val == 'function'){
    val.hasOwnProperty(SRC) || hide(val, SRC, O[key] ? '' + O[key] : TPL.join(String(key)));
    val.hasOwnProperty('name') || hide(val, 'name', key);
  }
  if(O === global){
    O[key] = val;
  } else {
    if(!safe)delete O[key];
    hide(O, key, val);
  }
})(Function.prototype, TO_STRING, function toString(){
  return typeof this == 'function' && this[SRC] || $toString.call(this);
});
},{"./$.core":18,"./$.global":31,"./$.hide":33,"./$.uid":84}],64:[function(require,module,exports){
module.exports = function(regExp, replace){
  var replacer = replace === Object(replace) ? function(part){
    return replace[part];
  } : replace;
  return function(it){
    return String(it).replace(regExp, replacer);
  };
};
},{}],65:[function(require,module,exports){
// 7.2.9 SameValue(x, y)
module.exports = Object.is || function is(x, y){
  return x === y ? x !== 0 || 1 / x === 1 / y : x != x && y != y;
};
},{}],66:[function(require,module,exports){
// Works with __proto__ only. Old v8 can't work with null proto objects.
/* eslint-disable no-proto */
var getDesc  = require('./$').getDesc
  , isObject = require('./$.is-object')
  , anObject = require('./$.an-object');
var check = function(O, proto){
  anObject(O);
  if(!isObject(proto) && proto !== null)throw TypeError(proto + ": can't set as prototype!");
};
module.exports = {
  set: Object.setPrototypeOf || ('__proto__' in {} ? // eslint-disable-line
    function(test, buggy, set){
      try {
        set = require('./$.ctx')(Function.call, getDesc(Object.prototype, '__proto__').set, 2);
        set(test, []);
        buggy = !(test instanceof Array);
      } catch(e){ buggy = true; }
      return function setPrototypeOf(O, proto){
        check(O, proto);
        if(buggy)O.__proto__ = proto;
        else set(O, proto);
        return O;
      };
    }({}, false) : undefined),
  check: check
};
},{"./$":48,"./$.an-object":6,"./$.ctx":19,"./$.is-object":40}],67:[function(require,module,exports){

var global      = require('./$.global')
  , $           = require('./$')
  , DESCRIPTORS = require('./$.descriptors')
  , SPECIES     = require('./$.wks')('species');

module.exports = function(KEY){
  var C = global[KEY];
  if(DESCRIPTORS && C && !C[SPECIES])$.setDesc(C, SPECIES, {
    configurable: true,
    get: function(){ return this; }
  });
};
},{"./$":48,"./$.descriptors":21,"./$.global":31,"./$.wks":85}],68:[function(require,module,exports){
var def = require('./$').setDesc
  , has = require('./$.has')
  , TAG = require('./$.wks')('toStringTag');

module.exports = function(it, tag, stat){
  if(it && !has(it = stat ? it : it.prototype, TAG))def(it, TAG, {configurable: true, value: tag});
};
},{"./$":48,"./$.has":32,"./$.wks":85}],69:[function(require,module,exports){
var global = require('./$.global')
  , SHARED = '__core-js_shared__'
  , store  = global[SHARED] || (global[SHARED] = {});
module.exports = function(key){
  return store[key] || (store[key] = {});
};
},{"./$.global":31}],70:[function(require,module,exports){
// 7.3.20 SpeciesConstructor(O, defaultConstructor)
var anObject  = require('./$.an-object')
  , aFunction = require('./$.a-function')
  , SPECIES   = require('./$.wks')('species');
module.exports = function(O, D){
  var C = anObject(O).constructor, S;
  return C === undefined || (S = anObject(C)[SPECIES]) == undefined ? D : aFunction(S);
};
},{"./$.a-function":4,"./$.an-object":6,"./$.wks":85}],71:[function(require,module,exports){
module.exports = function(it, Constructor, name){
  if(!(it instanceof Constructor))throw TypeError(name + ": use the 'new' operator!");
  return it;
};
},{}],72:[function(require,module,exports){
var toInteger = require('./$.to-integer')
  , defined   = require('./$.defined');
// true  -> String#at
// false -> String#codePointAt
module.exports = function(TO_STRING){
  return function(that, pos){
    var s = String(defined(that))
      , i = toInteger(pos)
      , l = s.length
      , a, b;
    if(i < 0 || i >= l)return TO_STRING ? '' : undefined;
    a = s.charCodeAt(i);
    return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff
      ? TO_STRING ? s.charAt(i) : a
      : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
  };
};
},{"./$.defined":20,"./$.to-integer":79}],73:[function(require,module,exports){
// helper for String#{startsWith, endsWith, includes}
var isRegExp = require('./$.is-regexp')
  , defined  = require('./$.defined');

module.exports = function(that, searchString, NAME){
  if(isRegExp(searchString))throw TypeError('String#' + NAME + " doesn't accept regex!");
  return String(defined(that));
};
},{"./$.defined":20,"./$.is-regexp":41}],74:[function(require,module,exports){
// https://github.com/ljharb/proposal-string-pad-left-right
var toLength = require('./$.to-length')
  , repeat   = require('./$.string-repeat')
  , defined  = require('./$.defined');

module.exports = function(that, maxLength, fillString, left){
  var S            = String(defined(that))
    , stringLength = S.length
    , fillStr      = fillString === undefined ? ' ' : String(fillString)
    , intMaxLength = toLength(maxLength);
  if(intMaxLength <= stringLength)return S;
  if(fillStr == '')fillStr = ' ';
  var fillLen = intMaxLength - stringLength
    , stringFiller = repeat.call(fillStr, Math.ceil(fillLen / fillStr.length));
  if(stringFiller.length > fillLen)stringFiller = stringFiller.slice(0, fillLen);
  return left ? stringFiller + S : S + stringFiller;
};
},{"./$.defined":20,"./$.string-repeat":75,"./$.to-length":81}],75:[function(require,module,exports){

var toInteger = require('./$.to-integer')
  , defined   = require('./$.defined');

module.exports = function repeat(count){
  var str = String(defined(this))
    , res = ''
    , n   = toInteger(count);
  if(n < 0 || n == Infinity)throw RangeError("Count can't be negative");
  for(;n > 0; (n >>>= 1) && (str += str))if(n & 1)res += str;
  return res;
};
},{"./$.defined":20,"./$.to-integer":79}],76:[function(require,module,exports){
var $export = require('./$.export')
  , defined = require('./$.defined')
  , fails   = require('./$.fails')
  , spaces  = '\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u180E\u2000\u2001\u2002\u2003' +
      '\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028\u2029\uFEFF'
  , space   = '[' + spaces + ']'
  , non     = '\u200b\u0085'
  , ltrim   = RegExp('^' + space + space + '*')
  , rtrim   = RegExp(space + space + '*$');

var exporter = function(KEY, exec){
  var exp  = {};
  exp[KEY] = exec(trim);
  $export($export.P + $export.F * fails(function(){
    return !!spaces[KEY]() || non[KEY]() != non;
  }), 'String', exp);
};

// 1 -> String#trimLeft
// 2 -> String#trimRight
// 3 -> String#trim
var trim = exporter.trim = function(string, TYPE){
  string = String(defined(string));
  if(TYPE & 1)string = string.replace(ltrim, '');
  if(TYPE & 2)string = string.replace(rtrim, '');
  return string;
};

module.exports = exporter;
},{"./$.defined":20,"./$.export":24,"./$.fails":26}],77:[function(require,module,exports){
var ctx                = require('./$.ctx')
  , invoke             = require('./$.invoke')
  , html               = require('./$.html')
  , cel                = require('./$.dom-create')
  , global             = require('./$.global')
  , process            = global.process
  , setTask            = global.setImmediate
  , clearTask          = global.clearImmediate
  , MessageChannel     = global.MessageChannel
  , counter            = 0
  , queue              = {}
  , ONREADYSTATECHANGE = 'onreadystatechange'
  , defer, channel, port;
var run = function(){
  var id = +this;
  if(queue.hasOwnProperty(id)){
    var fn = queue[id];
    delete queue[id];
    fn();
  }
};
var listner = function(event){
  run.call(event.data);
};
// Node.js 0.9+ & IE10+ has setImmediate, otherwise:
if(!setTask || !clearTask){
  setTask = function setImmediate(fn){
    var args = [], i = 1;
    while(arguments.length > i)args.push(arguments[i++]);
    queue[++counter] = function(){
      invoke(typeof fn == 'function' ? fn : Function(fn), args);
    };
    defer(counter);
    return counter;
  };
  clearTask = function clearImmediate(id){
    delete queue[id];
  };
  // Node.js 0.8-
  if(require('./$.cof')(process) == 'process'){
    defer = function(id){
      process.nextTick(ctx(run, id, 1));
    };
  // Browsers with MessageChannel, includes WebWorkers
  } else if(MessageChannel){
    channel = new MessageChannel;
    port    = channel.port2;
    channel.port1.onmessage = listner;
    defer = ctx(port.postMessage, port, 1);
  // Browsers with postMessage, skip WebWorkers
  // IE8 has postMessage, but it's sync & typeof its postMessage is 'object'
  } else if(global.addEventListener && typeof postMessage == 'function' && !global.importScripts){
    defer = function(id){
      global.postMessage(id + '', '*');
    };
    global.addEventListener('message', listner, false);
  // IE8-
  } else if(ONREADYSTATECHANGE in cel('script')){
    defer = function(id){
      html.appendChild(cel('script'))[ONREADYSTATECHANGE] = function(){
        html.removeChild(this);
        run.call(id);
      };
    };
  // Rest old browsers
  } else {
    defer = function(id){
      setTimeout(ctx(run, id, 1), 0);
    };
  }
}
module.exports = {
  set:   setTask,
  clear: clearTask
};
},{"./$.cof":13,"./$.ctx":19,"./$.dom-create":22,"./$.global":31,"./$.html":34,"./$.invoke":35}],78:[function(require,module,exports){
var toInteger = require('./$.to-integer')
  , max       = Math.max
  , min       = Math.min;
module.exports = function(index, length){
  index = toInteger(index);
  return index < 0 ? max(index + length, 0) : min(index, length);
};
},{"./$.to-integer":79}],79:[function(require,module,exports){
// 7.1.4 ToInteger
var ceil  = Math.ceil
  , floor = Math.floor;
module.exports = function(it){
  return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
};
},{}],80:[function(require,module,exports){
// to indexed object, toObject with fallback for non-array-like ES3 strings
var IObject = require('./$.iobject')
  , defined = require('./$.defined');
module.exports = function(it){
  return IObject(defined(it));
};
},{"./$.defined":20,"./$.iobject":36}],81:[function(require,module,exports){
// 7.1.15 ToLength
var toInteger = require('./$.to-integer')
  , min       = Math.min;
module.exports = function(it){
  return it > 0 ? min(toInteger(it), 0x1fffffffffffff) : 0; // pow(2, 53) - 1 == 9007199254740991
};
},{"./$.to-integer":79}],82:[function(require,module,exports){
// 7.1.13 ToObject(argument)
var defined = require('./$.defined');
module.exports = function(it){
  return Object(defined(it));
};
},{"./$.defined":20}],83:[function(require,module,exports){
// 7.1.1 ToPrimitive(input [, PreferredType])
var isObject = require('./$.is-object');
// instead of the ES6 spec version, we didn't implement @@toPrimitive case
// and the second argument - flag - preferred type is a string
module.exports = function(it, S){
  if(!isObject(it))return it;
  var fn, val;
  if(S && typeof (fn = it.toString) == 'function' && !isObject(val = fn.call(it)))return val;
  if(typeof (fn = it.valueOf) == 'function' && !isObject(val = fn.call(it)))return val;
  if(!S && typeof (fn = it.toString) == 'function' && !isObject(val = fn.call(it)))return val;
  throw TypeError("Can't convert object to primitive value");
};
},{"./$.is-object":40}],84:[function(require,module,exports){
var id = 0
  , px = Math.random();
module.exports = function(key){
  return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++id + px).toString(36));
};
},{}],85:[function(require,module,exports){
var store  = require('./$.shared')('wks')
  , uid    = require('./$.uid')
  , Symbol = require('./$.global').Symbol;
module.exports = function(name){
  return store[name] || (store[name] =
    Symbol && Symbol[name] || (Symbol || uid)('Symbol.' + name));
};
},{"./$.global":31,"./$.shared":69,"./$.uid":84}],86:[function(require,module,exports){
var classof   = require('./$.classof')
  , ITERATOR  = require('./$.wks')('iterator')
  , Iterators = require('./$.iterators');
module.exports = require('./$.core').getIteratorMethod = function(it){
  if(it != undefined)return it[ITERATOR]
    || it['@@iterator']
    || Iterators[classof(it)];
};
},{"./$.classof":12,"./$.core":18,"./$.iterators":47,"./$.wks":85}],87:[function(require,module,exports){

var $                 = require('./$')
  , $export           = require('./$.export')
  , DESCRIPTORS       = require('./$.descriptors')
  , createDesc        = require('./$.property-desc')
  , html              = require('./$.html')
  , cel               = require('./$.dom-create')
  , has               = require('./$.has')
  , cof               = require('./$.cof')
  , invoke            = require('./$.invoke')
  , fails             = require('./$.fails')
  , anObject          = require('./$.an-object')
  , aFunction         = require('./$.a-function')
  , isObject          = require('./$.is-object')
  , toObject          = require('./$.to-object')
  , toIObject         = require('./$.to-iobject')
  , toInteger         = require('./$.to-integer')
  , toIndex           = require('./$.to-index')
  , toLength          = require('./$.to-length')
  , IObject           = require('./$.iobject')
  , IE_PROTO          = require('./$.uid')('__proto__')
  , createArrayMethod = require('./$.array-methods')
  , arrayIndexOf      = require('./$.array-includes')(false)
  , ObjectProto       = Object.prototype
  , ArrayProto        = Array.prototype
  , arraySlice        = ArrayProto.slice
  , arrayJoin         = ArrayProto.join
  , defineProperty    = $.setDesc
  , getOwnDescriptor  = $.getDesc
  , defineProperties  = $.setDescs
  , factories         = {}
  , IE8_DOM_DEFINE;

if(!DESCRIPTORS){
  IE8_DOM_DEFINE = !fails(function(){
    return defineProperty(cel('div'), 'a', {get: function(){ return 7; }}).a != 7;
  });
  $.setDesc = function(O, P, Attributes){
    if(IE8_DOM_DEFINE)try {
      return defineProperty(O, P, Attributes);
    } catch(e){ /* empty */ }
    if('get' in Attributes || 'set' in Attributes)throw TypeError('Accessors not supported!');
    if('value' in Attributes)anObject(O)[P] = Attributes.value;
    return O;
  };
  $.getDesc = function(O, P){
    if(IE8_DOM_DEFINE)try {
      return getOwnDescriptor(O, P);
    } catch(e){ /* empty */ }
    if(has(O, P))return createDesc(!ObjectProto.propertyIsEnumerable.call(O, P), O[P]);
  };
  $.setDescs = defineProperties = function(O, Properties){
    anObject(O);
    var keys   = $.getKeys(Properties)
      , length = keys.length
      , i = 0
      , P;
    while(length > i)$.setDesc(O, P = keys[i++], Properties[P]);
    return O;
  };
}
$export($export.S + $export.F * !DESCRIPTORS, 'Object', {
  // 19.1.2.6 / 15.2.3.3 Object.getOwnPropertyDescriptor(O, P)
  getOwnPropertyDescriptor: $.getDesc,
  // 19.1.2.4 / 15.2.3.6 Object.defineProperty(O, P, Attributes)
  defineProperty: $.setDesc,
  // 19.1.2.3 / 15.2.3.7 Object.defineProperties(O, Properties)
  defineProperties: defineProperties
});

  // IE 8- don't enum bug keys
var keys1 = ('constructor,hasOwnProperty,isPrototypeOf,propertyIsEnumerable,' +
            'toLocaleString,toString,valueOf').split(',')
  // Additional keys for getOwnPropertyNames
  , keys2 = keys1.concat('length', 'prototype')
  , keysLen1 = keys1.length;

// Create object with `null` prototype: use iframe Object with cleared prototype
var createDict = function(){
  // Thrash, waste and sodomy: IE GC bug
  var iframe = cel('iframe')
    , i      = keysLen1
    , gt     = '>'
    , iframeDocument;
  iframe.style.display = 'none';
  html.appendChild(iframe);
  iframe.src = 'javascript:'; // eslint-disable-line no-script-url
  // createDict = iframe.contentWindow.Object;
  // html.removeChild(iframe);
  iframeDocument = iframe.contentWindow.document;
  iframeDocument.open();
  iframeDocument.write('<script>document.F=Object</script' + gt);
  iframeDocument.close();
  createDict = iframeDocument.F;
  while(i--)delete createDict.prototype[keys1[i]];
  return createDict();
};
var createGetKeys = function(names, length){
  return function(object){
    var O      = toIObject(object)
      , i      = 0
      , result = []
      , key;
    for(key in O)if(key != IE_PROTO)has(O, key) && result.push(key);
    // Don't enum bug & hidden keys
    while(length > i)if(has(O, key = names[i++])){
      ~arrayIndexOf(result, key) || result.push(key);
    }
    return result;
  };
};
var Empty = function(){};
$export($export.S, 'Object', {
  // 19.1.2.9 / 15.2.3.2 Object.getPrototypeOf(O)
  getPrototypeOf: $.getProto = $.getProto || function(O){
    O = toObject(O);
    if(has(O, IE_PROTO))return O[IE_PROTO];
    if(typeof O.constructor == 'function' && O instanceof O.constructor){
      return O.constructor.prototype;
    } return O instanceof Object ? ObjectProto : null;
  },
  // 19.1.2.7 / 15.2.3.4 Object.getOwnPropertyNames(O)
  getOwnPropertyNames: $.getNames = $.getNames || createGetKeys(keys2, keys2.length, true),
  // 19.1.2.2 / 15.2.3.5 Object.create(O [, Properties])
  create: $.create = $.create || function(O, /*?*/Properties){
    var result;
    if(O !== null){
      Empty.prototype = anObject(O);
      result = new Empty();
      Empty.prototype = null;
      // add "__proto__" for Object.getPrototypeOf shim
      result[IE_PROTO] = O;
    } else result = createDict();
    return Properties === undefined ? result : defineProperties(result, Properties);
  },
  // 19.1.2.14 / 15.2.3.14 Object.keys(O)
  keys: $.getKeys = $.getKeys || createGetKeys(keys1, keysLen1, false)
});

var construct = function(F, len, args){
  if(!(len in factories)){
    for(var n = [], i = 0; i < len; i++)n[i] = 'a[' + i + ']';
    factories[len] = Function('F,a', 'return new F(' + n.join(',') + ')');
  }
  return factories[len](F, args);
};

// 19.2.3.2 / 15.3.4.5 Function.prototype.bind(thisArg, args...)
$export($export.P, 'Function', {
  bind: function bind(that /*, args... */){
    var fn       = aFunction(this)
      , partArgs = arraySlice.call(arguments, 1);
    var bound = function(/* args... */){
      var args = partArgs.concat(arraySlice.call(arguments));
      return this instanceof bound ? construct(fn, args.length, args) : invoke(fn, args, that);
    };
    if(isObject(fn.prototype))bound.prototype = fn.prototype;
    return bound;
  }
});

// fallback for not array-like ES3 strings and DOM objects
$export($export.P + $export.F * fails(function(){
  if(html)arraySlice.call(html);
}), 'Array', {
  slice: function(begin, end){
    var len   = toLength(this.length)
      , klass = cof(this);
    end = end === undefined ? len : end;
    if(klass == 'Array')return arraySlice.call(this, begin, end);
    var start  = toIndex(begin, len)
      , upTo   = toIndex(end, len)
      , size   = toLength(upTo - start)
      , cloned = Array(size)
      , i      = 0;
    for(; i < size; i++)cloned[i] = klass == 'String'
      ? this.charAt(start + i)
      : this[start + i];
    return cloned;
  }
});
$export($export.P + $export.F * (IObject != Object), 'Array', {
  join: function join(separator){
    return arrayJoin.call(IObject(this), separator === undefined ? ',' : separator);
  }
});

// 22.1.2.2 / 15.4.3.2 Array.isArray(arg)
$export($export.S, 'Array', {isArray: require('./$.is-array')});

var createArrayReduce = function(isRight){
  return function(callbackfn, memo){
    aFunction(callbackfn);
    var O      = IObject(this)
      , length = toLength(O.length)
      , index  = isRight ? length - 1 : 0
      , i      = isRight ? -1 : 1;
    if(arguments.length < 2)for(;;){
      if(index in O){
        memo = O[index];
        index += i;
        break;
      }
      index += i;
      if(isRight ? index < 0 : length <= index){
        throw TypeError('Reduce of empty array with no initial value');
      }
    }
    for(;isRight ? index >= 0 : length > index; index += i)if(index in O){
      memo = callbackfn(memo, O[index], index, this);
    }
    return memo;
  };
};

var methodize = function($fn){
  return function(arg1/*, arg2 = undefined */){
    return $fn(this, arg1, arguments[1]);
  };
};

$export($export.P, 'Array', {
  // 22.1.3.10 / 15.4.4.18 Array.prototype.forEach(callbackfn [, thisArg])
  forEach: $.each = $.each || methodize(createArrayMethod(0)),
  // 22.1.3.15 / 15.4.4.19 Array.prototype.map(callbackfn [, thisArg])
  map: methodize(createArrayMethod(1)),
  // 22.1.3.7 / 15.4.4.20 Array.prototype.filter(callbackfn [, thisArg])
  filter: methodize(createArrayMethod(2)),
  // 22.1.3.23 / 15.4.4.17 Array.prototype.some(callbackfn [, thisArg])
  some: methodize(createArrayMethod(3)),
  // 22.1.3.5 / 15.4.4.16 Array.prototype.every(callbackfn [, thisArg])
  every: methodize(createArrayMethod(4)),
  // 22.1.3.18 / 15.4.4.21 Array.prototype.reduce(callbackfn [, initialValue])
  reduce: createArrayReduce(false),
  // 22.1.3.19 / 15.4.4.22 Array.prototype.reduceRight(callbackfn [, initialValue])
  reduceRight: createArrayReduce(true),
  // 22.1.3.11 / 15.4.4.14 Array.prototype.indexOf(searchElement [, fromIndex])
  indexOf: methodize(arrayIndexOf),
  // 22.1.3.14 / 15.4.4.15 Array.prototype.lastIndexOf(searchElement [, fromIndex])
  lastIndexOf: function(el, fromIndex /* = @[*-1] */){
    var O      = toIObject(this)
      , length = toLength(O.length)
      , index  = length - 1;
    if(arguments.length > 1)index = Math.min(index, toInteger(fromIndex));
    if(index < 0)index = toLength(length + index);
    for(;index >= 0; index--)if(index in O)if(O[index] === el)return index;
    return -1;
  }
});

// 20.3.3.1 / 15.9.4.4 Date.now()
$export($export.S, 'Date', {now: function(){ return +new Date; }});

var lz = function(num){
  return num > 9 ? num : '0' + num;
};

// 20.3.4.36 / 15.9.5.43 Date.prototype.toISOString()
// PhantomJS / old WebKit has a broken implementations
$export($export.P + $export.F * (fails(function(){
  return new Date(-5e13 - 1).toISOString() != '0385-07-25T07:06:39.999Z';
}) || !fails(function(){
  new Date(NaN).toISOString();
})), 'Date', {
  toISOString: function toISOString(){
    if(!isFinite(this))throw RangeError('Invalid time value');
    var d = this
      , y = d.getUTCFullYear()
      , m = d.getUTCMilliseconds()
      , s = y < 0 ? '-' : y > 9999 ? '+' : '';
    return s + ('00000' + Math.abs(y)).slice(s ? -6 : -4) +
      '-' + lz(d.getUTCMonth() + 1) + '-' + lz(d.getUTCDate()) +
      'T' + lz(d.getUTCHours()) + ':' + lz(d.getUTCMinutes()) +
      ':' + lz(d.getUTCSeconds()) + '.' + (m > 99 ? m : '0' + lz(m)) + 'Z';
  }
});
},{"./$":48,"./$.a-function":4,"./$.an-object":6,"./$.array-includes":9,"./$.array-methods":10,"./$.cof":13,"./$.descriptors":21,"./$.dom-create":22,"./$.export":24,"./$.fails":26,"./$.has":32,"./$.html":34,"./$.invoke":35,"./$.iobject":36,"./$.is-array":38,"./$.is-object":40,"./$.property-desc":61,"./$.to-index":78,"./$.to-integer":79,"./$.to-iobject":80,"./$.to-length":81,"./$.to-object":82,"./$.uid":84}],88:[function(require,module,exports){
// 22.1.3.3 Array.prototype.copyWithin(target, start, end = this.length)
var $export = require('./$.export');

$export($export.P, 'Array', {copyWithin: require('./$.array-copy-within')});

require('./$.add-to-unscopables')('copyWithin');
},{"./$.add-to-unscopables":5,"./$.array-copy-within":7,"./$.export":24}],89:[function(require,module,exports){
// 22.1.3.6 Array.prototype.fill(value, start = 0, end = this.length)
var $export = require('./$.export');

$export($export.P, 'Array', {fill: require('./$.array-fill')});

require('./$.add-to-unscopables')('fill');
},{"./$.add-to-unscopables":5,"./$.array-fill":8,"./$.export":24}],90:[function(require,module,exports){

// 22.1.3.9 Array.prototype.findIndex(predicate, thisArg = undefined)
var $export = require('./$.export')
  , $find   = require('./$.array-methods')(6)
  , KEY     = 'findIndex'
  , forced  = true;
// Shouldn't skip holes
if(KEY in [])Array(1)[KEY](function(){ forced = false; });
$export($export.P + $export.F * forced, 'Array', {
  findIndex: function findIndex(callbackfn/*, that = undefined */){
    return $find(this, callbackfn, arguments.length > 1 ? arguments[1] : undefined);
  }
});
require('./$.add-to-unscopables')(KEY);
},{"./$.add-to-unscopables":5,"./$.array-methods":10,"./$.export":24}],91:[function(require,module,exports){

// 22.1.3.8 Array.prototype.find(predicate, thisArg = undefined)
var $export = require('./$.export')
  , $find   = require('./$.array-methods')(5)
  , KEY     = 'find'
  , forced  = true;
// Shouldn't skip holes
if(KEY in [])Array(1)[KEY](function(){ forced = false; });
$export($export.P + $export.F * forced, 'Array', {
  find: function find(callbackfn/*, that = undefined */){
    return $find(this, callbackfn, arguments.length > 1 ? arguments[1] : undefined);
  }
});
require('./$.add-to-unscopables')(KEY);
},{"./$.add-to-unscopables":5,"./$.array-methods":10,"./$.export":24}],92:[function(require,module,exports){

var ctx         = require('./$.ctx')
  , $export     = require('./$.export')
  , toObject    = require('./$.to-object')
  , call        = require('./$.iter-call')
  , isArrayIter = require('./$.is-array-iter')
  , toLength    = require('./$.to-length')
  , getIterFn   = require('./core.get-iterator-method');
$export($export.S + $export.F * !require('./$.iter-detect')(function(iter){ Array.from(iter); }), 'Array', {
  // 22.1.2.1 Array.from(arrayLike, mapfn = undefined, thisArg = undefined)
  from: function from(arrayLike/*, mapfn = undefined, thisArg = undefined*/){
    var O       = toObject(arrayLike)
      , C       = typeof this == 'function' ? this : Array
      , $$      = arguments
      , $$len   = $$.length
      , mapfn   = $$len > 1 ? $$[1] : undefined
      , mapping = mapfn !== undefined
      , index   = 0
      , iterFn  = getIterFn(O)
      , length, result, step, iterator;
    if(mapping)mapfn = ctx(mapfn, $$len > 2 ? $$[2] : undefined, 2);
    // if object isn't iterable or it's array with default iterator - use simple case
    if(iterFn != undefined && !(C == Array && isArrayIter(iterFn))){
      for(iterator = iterFn.call(O), result = new C; !(step = iterator.next()).done; index++){
        result[index] = mapping ? call(iterator, mapfn, [step.value, index], true) : step.value;
      }
    } else {
      length = toLength(O.length);
      for(result = new C(length); length > index; index++){
        result[index] = mapping ? mapfn(O[index], index) : O[index];
      }
    }
    result.length = index;
    return result;
  }
});

},{"./$.ctx":19,"./$.export":24,"./$.is-array-iter":37,"./$.iter-call":42,"./$.iter-detect":45,"./$.to-length":81,"./$.to-object":82,"./core.get-iterator-method":86}],93:[function(require,module,exports){

var addToUnscopables = require('./$.add-to-unscopables')
  , step             = require('./$.iter-step')
  , Iterators        = require('./$.iterators')
  , toIObject        = require('./$.to-iobject');

// 22.1.3.4 Array.prototype.entries()
// 22.1.3.13 Array.prototype.keys()
// 22.1.3.29 Array.prototype.values()
// 22.1.3.30 Array.prototype[@@iterator]()
module.exports = require('./$.iter-define')(Array, 'Array', function(iterated, kind){
  this._t = toIObject(iterated); // target
  this._i = 0;                   // next index
  this._k = kind;                // kind
// 22.1.5.2.1 %ArrayIteratorPrototype%.next()
}, function(){
  var O     = this._t
    , kind  = this._k
    , index = this._i++;
  if(!O || index >= O.length){
    this._t = undefined;
    return step(1);
  }
  if(kind == 'keys'  )return step(0, index);
  if(kind == 'values')return step(0, O[index]);
  return step(0, [index, O[index]]);
}, 'values');

// argumentsList[@@iterator] is %ArrayProto_values% (9.4.4.6, 9.4.4.7)
Iterators.Arguments = Iterators.Array;

addToUnscopables('keys');
addToUnscopables('values');
addToUnscopables('entries');
},{"./$.add-to-unscopables":5,"./$.iter-define":44,"./$.iter-step":46,"./$.iterators":47,"./$.to-iobject":80}],94:[function(require,module,exports){

var $export = require('./$.export');

// WebKit Array.of isn't generic
$export($export.S + $export.F * require('./$.fails')(function(){
  function F(){}
  return !(Array.of.call(F) instanceof F);
}), 'Array', {
  // 22.1.2.3 Array.of( ...items)
  of: function of(/* ...args */){
    var index  = 0
      , $$     = arguments
      , $$len  = $$.length
      , result = new (typeof this == 'function' ? this : Array)($$len);
    while($$len > index)result[index] = $$[index++];
    result.length = $$len;
    return result;
  }
});
},{"./$.export":24,"./$.fails":26}],95:[function(require,module,exports){
require('./$.set-species')('Array');
},{"./$.set-species":67}],96:[function(require,module,exports){

var $             = require('./$')
  , isObject      = require('./$.is-object')
  , HAS_INSTANCE  = require('./$.wks')('hasInstance')
  , FunctionProto = Function.prototype;
// 19.2.3.6 Function.prototype[@@hasInstance](V)
if(!(HAS_INSTANCE in FunctionProto))$.setDesc(FunctionProto, HAS_INSTANCE, {value: function(O){
  if(typeof this != 'function' || !isObject(O))return false;
  if(!isObject(this.prototype))return O instanceof this;
  // for environment w/o native `@@hasInstance` logic enough `instanceof`, but add this:
  while(O = $.getProto(O))if(this.prototype === O)return true;
  return false;
}});
},{"./$":48,"./$.is-object":40,"./$.wks":85}],97:[function(require,module,exports){
var setDesc    = require('./$').setDesc
  , createDesc = require('./$.property-desc')
  , has        = require('./$.has')
  , FProto     = Function.prototype
  , nameRE     = /^\s*function ([^ (]*)/
  , NAME       = 'name';
// 19.2.4.2 name
NAME in FProto || require('./$.descriptors') && setDesc(FProto, NAME, {
  configurable: true,
  get: function(){
    var match = ('' + this).match(nameRE)
      , name  = match ? match[1] : '';
    has(this, NAME) || setDesc(this, NAME, createDesc(5, name));
    return name;
  }
});
},{"./$":48,"./$.descriptors":21,"./$.has":32,"./$.property-desc":61}],98:[function(require,module,exports){

var strong = require('./$.collection-strong');

// 23.1 Map Objects
require('./$.collection')('Map', function(get){
  return function Map(){ return get(this, arguments.length > 0 ? arguments[0] : undefined); };
}, {
  // 23.1.3.6 Map.prototype.get(key)
  get: function get(key){
    var entry = strong.getEntry(this, key);
    return entry && entry.v;
  },
  // 23.1.3.9 Map.prototype.set(key, value)
  set: function set(key, value){
    return strong.def(this, key === 0 ? 0 : key, value);
  }
}, strong, true);
},{"./$.collection":17,"./$.collection-strong":14}],99:[function(require,module,exports){
// 20.2.2.3 Math.acosh(x)
var $export = require('./$.export')
  , log1p   = require('./$.math-log1p')
  , sqrt    = Math.sqrt
  , $acosh  = Math.acosh;

// V8 bug https://code.google.com/p/v8/issues/detail?id=3509
$export($export.S + $export.F * !($acosh && Math.floor($acosh(Number.MAX_VALUE)) == 710), 'Math', {
  acosh: function acosh(x){
    return (x = +x) < 1 ? NaN : x > 94906265.62425156
      ? Math.log(x) + Math.LN2
      : log1p(x - 1 + sqrt(x - 1) * sqrt(x + 1));
  }
});
},{"./$.export":24,"./$.math-log1p":52}],100:[function(require,module,exports){
// 20.2.2.5 Math.asinh(x)
var $export = require('./$.export');

function asinh(x){
  return !isFinite(x = +x) || x == 0 ? x : x < 0 ? -asinh(-x) : Math.log(x + Math.sqrt(x * x + 1));
}

$export($export.S, 'Math', {asinh: asinh});
},{"./$.export":24}],101:[function(require,module,exports){
// 20.2.2.7 Math.atanh(x)
var $export = require('./$.export');

$export($export.S, 'Math', {
  atanh: function atanh(x){
    return (x = +x) == 0 ? x : Math.log((1 + x) / (1 - x)) / 2;
  }
});
},{"./$.export":24}],102:[function(require,module,exports){
// 20.2.2.9 Math.cbrt(x)
var $export = require('./$.export')
  , sign    = require('./$.math-sign');

$export($export.S, 'Math', {
  cbrt: function cbrt(x){
    return sign(x = +x) * Math.pow(Math.abs(x), 1 / 3);
  }
});
},{"./$.export":24,"./$.math-sign":53}],103:[function(require,module,exports){
// 20.2.2.11 Math.clz32(x)
var $export = require('./$.export');

$export($export.S, 'Math', {
  clz32: function clz32(x){
    return (x >>>= 0) ? 31 - Math.floor(Math.log(x + 0.5) * Math.LOG2E) : 32;
  }
});
},{"./$.export":24}],104:[function(require,module,exports){
// 20.2.2.12 Math.cosh(x)
var $export = require('./$.export')
  , exp     = Math.exp;

$export($export.S, 'Math', {
  cosh: function cosh(x){
    return (exp(x = +x) + exp(-x)) / 2;
  }
});
},{"./$.export":24}],105:[function(require,module,exports){
// 20.2.2.14 Math.expm1(x)
var $export = require('./$.export');

$export($export.S, 'Math', {expm1: require('./$.math-expm1')});
},{"./$.export":24,"./$.math-expm1":51}],106:[function(require,module,exports){
// 20.2.2.16 Math.fround(x)
var $export   = require('./$.export')
  , sign      = require('./$.math-sign')
  , pow       = Math.pow
  , EPSILON   = pow(2, -52)
  , EPSILON32 = pow(2, -23)
  , MAX32     = pow(2, 127) * (2 - EPSILON32)
  , MIN32     = pow(2, -126);

var roundTiesToEven = function(n){
  return n + 1 / EPSILON - 1 / EPSILON;
};


$export($export.S, 'Math', {
  fround: function fround(x){
    var $abs  = Math.abs(x)
      , $sign = sign(x)
      , a, result;
    if($abs < MIN32)return $sign * roundTiesToEven($abs / MIN32 / EPSILON32) * MIN32 * EPSILON32;
    a = (1 + EPSILON32 / EPSILON) * $abs;
    result = a - (a - $abs);
    if(result > MAX32 || result != result)return $sign * Infinity;
    return $sign * result;
  }
});
},{"./$.export":24,"./$.math-sign":53}],107:[function(require,module,exports){
// 20.2.2.17 Math.hypot([value1[, value2[, … ]]])
var $export = require('./$.export')
  , abs     = Math.abs;

$export($export.S, 'Math', {
  hypot: function hypot(value1, value2){ // eslint-disable-line no-unused-vars
    var sum   = 0
      , i     = 0
      , $$    = arguments
      , $$len = $$.length
      , larg  = 0
      , arg, div;
    while(i < $$len){
      arg = abs($$[i++]);
      if(larg < arg){
        div  = larg / arg;
        sum  = sum * div * div + 1;
        larg = arg;
      } else if(arg > 0){
        div  = arg / larg;
        sum += div * div;
      } else sum += arg;
    }
    return larg === Infinity ? Infinity : larg * Math.sqrt(sum);
  }
});
},{"./$.export":24}],108:[function(require,module,exports){
// 20.2.2.18 Math.imul(x, y)
var $export = require('./$.export')
  , $imul   = Math.imul;

// some WebKit versions fails with big numbers, some has wrong arity
$export($export.S + $export.F * require('./$.fails')(function(){
  return $imul(0xffffffff, 5) != -5 || $imul.length != 2;
}), 'Math', {
  imul: function imul(x, y){
    var UINT16 = 0xffff
      , xn = +x
      , yn = +y
      , xl = UINT16 & xn
      , yl = UINT16 & yn;
    return 0 | xl * yl + ((UINT16 & xn >>> 16) * yl + xl * (UINT16 & yn >>> 16) << 16 >>> 0);
  }
});
},{"./$.export":24,"./$.fails":26}],109:[function(require,module,exports){
// 20.2.2.21 Math.log10(x)
var $export = require('./$.export');

$export($export.S, 'Math', {
  log10: function log10(x){
    return Math.log(x) / Math.LN10;
  }
});
},{"./$.export":24}],110:[function(require,module,exports){
// 20.2.2.20 Math.log1p(x)
var $export = require('./$.export');

$export($export.S, 'Math', {log1p: require('./$.math-log1p')});
},{"./$.export":24,"./$.math-log1p":52}],111:[function(require,module,exports){
// 20.2.2.22 Math.log2(x)
var $export = require('./$.export');

$export($export.S, 'Math', {
  log2: function log2(x){
    return Math.log(x) / Math.LN2;
  }
});
},{"./$.export":24}],112:[function(require,module,exports){
// 20.2.2.28 Math.sign(x)
var $export = require('./$.export');

$export($export.S, 'Math', {sign: require('./$.math-sign')});
},{"./$.export":24,"./$.math-sign":53}],113:[function(require,module,exports){
// 20.2.2.30 Math.sinh(x)
var $export = require('./$.export')
  , expm1   = require('./$.math-expm1')
  , exp     = Math.exp;

// V8 near Chromium 38 has a problem with very small numbers
$export($export.S + $export.F * require('./$.fails')(function(){
  return !Math.sinh(-2e-17) != -2e-17;
}), 'Math', {
  sinh: function sinh(x){
    return Math.abs(x = +x) < 1
      ? (expm1(x) - expm1(-x)) / 2
      : (exp(x - 1) - exp(-x - 1)) * (Math.E / 2);
  }
});
},{"./$.export":24,"./$.fails":26,"./$.math-expm1":51}],114:[function(require,module,exports){
// 20.2.2.33 Math.tanh(x)
var $export = require('./$.export')
  , expm1   = require('./$.math-expm1')
  , exp     = Math.exp;

$export($export.S, 'Math', {
  tanh: function tanh(x){
    var a = expm1(x = +x)
      , b = expm1(-x);
    return a == Infinity ? 1 : b == Infinity ? -1 : (a - b) / (exp(x) + exp(-x));
  }
});
},{"./$.export":24,"./$.math-expm1":51}],115:[function(require,module,exports){
// 20.2.2.34 Math.trunc(x)
var $export = require('./$.export');

$export($export.S, 'Math', {
  trunc: function trunc(it){
    return (it > 0 ? Math.floor : Math.ceil)(it);
  }
});
},{"./$.export":24}],116:[function(require,module,exports){

var $           = require('./$')
  , global      = require('./$.global')
  , has         = require('./$.has')
  , cof         = require('./$.cof')
  , toPrimitive = require('./$.to-primitive')
  , fails       = require('./$.fails')
  , $trim       = require('./$.string-trim').trim
  , NUMBER      = 'Number'
  , $Number     = global[NUMBER]
  , Base        = $Number
  , proto       = $Number.prototype
  // Opera ~12 has broken Object#toString
  , BROKEN_COF  = cof($.create(proto)) == NUMBER
  , TRIM        = 'trim' in String.prototype;

// 7.1.3 ToNumber(argument)
var toNumber = function(argument){
  var it = toPrimitive(argument, false);
  if(typeof it == 'string' && it.length > 2){
    it = TRIM ? it.trim() : $trim(it, 3);
    var first = it.charCodeAt(0)
      , third, radix, maxCode;
    if(first === 43 || first === 45){
      third = it.charCodeAt(2);
      if(third === 88 || third === 120)return NaN; // Number('+0x1') should be NaN, old V8 fix
    } else if(first === 48){
      switch(it.charCodeAt(1)){
        case 66 : case 98  : radix = 2; maxCode = 49; break; // fast equal /^0b[01]+$/i
        case 79 : case 111 : radix = 8; maxCode = 55; break; // fast equal /^0o[0-7]+$/i
        default : return +it;
      }
      for(var digits = it.slice(2), i = 0, l = digits.length, code; i < l; i++){
        code = digits.charCodeAt(i);
        // parseInt parses a string to a first unavailable symbol
        // but ToNumber should return NaN if a string contains unavailable symbols
        if(code < 48 || code > maxCode)return NaN;
      } return parseInt(digits, radix);
    }
  } return +it;
};

if(!$Number(' 0o1') || !$Number('0b1') || $Number('+0x1')){
  $Number = function Number(value){
    var it = arguments.length < 1 ? 0 : value
      , that = this;
    return that instanceof $Number
      // check on 1..constructor(foo) case
      && (BROKEN_COF ? fails(function(){ proto.valueOf.call(that); }) : cof(that) != NUMBER)
        ? new Base(toNumber(it)) : toNumber(it);
  };
  $.each.call(require('./$.descriptors') ? $.getNames(Base) : (
    // ES3:
    'MAX_VALUE,MIN_VALUE,NaN,NEGATIVE_INFINITY,POSITIVE_INFINITY,' +
    // ES6 (in case, if modules with ES6 Number statics required before):
    'EPSILON,isFinite,isInteger,isNaN,isSafeInteger,MAX_SAFE_INTEGER,' +
    'MIN_SAFE_INTEGER,parseFloat,parseInt,isInteger'
  ).split(','), function(key){
    if(has(Base, key) && !has($Number, key)){
      $.setDesc($Number, key, $.getDesc(Base, key));
    }
  });
  $Number.prototype = proto;
  proto.constructor = $Number;
  require('./$.redefine')(global, NUMBER, $Number);
}
},{"./$":48,"./$.cof":13,"./$.descriptors":21,"./$.fails":26,"./$.global":31,"./$.has":32,"./$.redefine":63,"./$.string-trim":76,"./$.to-primitive":83}],117:[function(require,module,exports){
// 20.1.2.1 Number.EPSILON
var $export = require('./$.export');

$export($export.S, 'Number', {EPSILON: Math.pow(2, -52)});
},{"./$.export":24}],118:[function(require,module,exports){
// 20.1.2.2 Number.isFinite(number)
var $export   = require('./$.export')
  , _isFinite = require('./$.global').isFinite;

$export($export.S, 'Number', {
  isFinite: function isFinite(it){
    return typeof it == 'number' && _isFinite(it);
  }
});
},{"./$.export":24,"./$.global":31}],119:[function(require,module,exports){
// 20.1.2.3 Number.isInteger(number)
var $export = require('./$.export');

$export($export.S, 'Number', {isInteger: require('./$.is-integer')});
},{"./$.export":24,"./$.is-integer":39}],120:[function(require,module,exports){
// 20.1.2.4 Number.isNaN(number)
var $export = require('./$.export');

$export($export.S, 'Number', {
  isNaN: function isNaN(number){
    return number != number;
  }
});
},{"./$.export":24}],121:[function(require,module,exports){
// 20.1.2.5 Number.isSafeInteger(number)
var $export   = require('./$.export')
  , isInteger = require('./$.is-integer')
  , abs       = Math.abs;

$export($export.S, 'Number', {
  isSafeInteger: function isSafeInteger(number){
    return isInteger(number) && abs(number) <= 0x1fffffffffffff;
  }
});
},{"./$.export":24,"./$.is-integer":39}],122:[function(require,module,exports){
// 20.1.2.6 Number.MAX_SAFE_INTEGER
var $export = require('./$.export');

$export($export.S, 'Number', {MAX_SAFE_INTEGER: 0x1fffffffffffff});
},{"./$.export":24}],123:[function(require,module,exports){
// 20.1.2.10 Number.MIN_SAFE_INTEGER
var $export = require('./$.export');

$export($export.S, 'Number', {MIN_SAFE_INTEGER: -0x1fffffffffffff});
},{"./$.export":24}],124:[function(require,module,exports){
// 20.1.2.12 Number.parseFloat(string)
var $export = require('./$.export');

$export($export.S, 'Number', {parseFloat: parseFloat});
},{"./$.export":24}],125:[function(require,module,exports){
// 20.1.2.13 Number.parseInt(string, radix)
var $export = require('./$.export');

$export($export.S, 'Number', {parseInt: parseInt});
},{"./$.export":24}],126:[function(require,module,exports){
// 19.1.3.1 Object.assign(target, source)
var $export = require('./$.export');

$export($export.S + $export.F, 'Object', {assign: require('./$.object-assign')});
},{"./$.export":24,"./$.object-assign":55}],127:[function(require,module,exports){
// 19.1.2.5 Object.freeze(O)
var isObject = require('./$.is-object');

require('./$.object-sap')('freeze', function($freeze){
  return function freeze(it){
    return $freeze && isObject(it) ? $freeze(it) : it;
  };
});
},{"./$.is-object":40,"./$.object-sap":56}],128:[function(require,module,exports){
// 19.1.2.6 Object.getOwnPropertyDescriptor(O, P)
var toIObject = require('./$.to-iobject');

require('./$.object-sap')('getOwnPropertyDescriptor', function($getOwnPropertyDescriptor){
  return function getOwnPropertyDescriptor(it, key){
    return $getOwnPropertyDescriptor(toIObject(it), key);
  };
});
},{"./$.object-sap":56,"./$.to-iobject":80}],129:[function(require,module,exports){
// 19.1.2.7 Object.getOwnPropertyNames(O)
require('./$.object-sap')('getOwnPropertyNames', function(){
  return require('./$.get-names').get;
});
},{"./$.get-names":30,"./$.object-sap":56}],130:[function(require,module,exports){
// 19.1.2.9 Object.getPrototypeOf(O)
var toObject = require('./$.to-object');

require('./$.object-sap')('getPrototypeOf', function($getPrototypeOf){
  return function getPrototypeOf(it){
    return $getPrototypeOf(toObject(it));
  };
});
},{"./$.object-sap":56,"./$.to-object":82}],131:[function(require,module,exports){
// 19.1.2.11 Object.isExtensible(O)
var isObject = require('./$.is-object');

require('./$.object-sap')('isExtensible', function($isExtensible){
  return function isExtensible(it){
    return isObject(it) ? $isExtensible ? $isExtensible(it) : true : false;
  };
});
},{"./$.is-object":40,"./$.object-sap":56}],132:[function(require,module,exports){
// 19.1.2.12 Object.isFrozen(O)
var isObject = require('./$.is-object');

require('./$.object-sap')('isFrozen', function($isFrozen){
  return function isFrozen(it){
    return isObject(it) ? $isFrozen ? $isFrozen(it) : false : true;
  };
});
},{"./$.is-object":40,"./$.object-sap":56}],133:[function(require,module,exports){
// 19.1.2.13 Object.isSealed(O)
var isObject = require('./$.is-object');

require('./$.object-sap')('isSealed', function($isSealed){
  return function isSealed(it){
    return isObject(it) ? $isSealed ? $isSealed(it) : false : true;
  };
});
},{"./$.is-object":40,"./$.object-sap":56}],134:[function(require,module,exports){
// 19.1.3.10 Object.is(value1, value2)
var $export = require('./$.export');
$export($export.S, 'Object', {is: require('./$.same-value')});
},{"./$.export":24,"./$.same-value":65}],135:[function(require,module,exports){
// 19.1.2.14 Object.keys(O)
var toObject = require('./$.to-object');

require('./$.object-sap')('keys', function($keys){
  return function keys(it){
    return $keys(toObject(it));
  };
});
},{"./$.object-sap":56,"./$.to-object":82}],136:[function(require,module,exports){
// 19.1.2.15 Object.preventExtensions(O)
var isObject = require('./$.is-object');

require('./$.object-sap')('preventExtensions', function($preventExtensions){
  return function preventExtensions(it){
    return $preventExtensions && isObject(it) ? $preventExtensions(it) : it;
  };
});
},{"./$.is-object":40,"./$.object-sap":56}],137:[function(require,module,exports){
// 19.1.2.17 Object.seal(O)
var isObject = require('./$.is-object');

require('./$.object-sap')('seal', function($seal){
  return function seal(it){
    return $seal && isObject(it) ? $seal(it) : it;
  };
});
},{"./$.is-object":40,"./$.object-sap":56}],138:[function(require,module,exports){
// 19.1.3.19 Object.setPrototypeOf(O, proto)
var $export = require('./$.export');
$export($export.S, 'Object', {setPrototypeOf: require('./$.set-proto').set});
},{"./$.export":24,"./$.set-proto":66}],139:[function(require,module,exports){

// 19.1.3.6 Object.prototype.toString()
var classof = require('./$.classof')
  , test    = {};
test[require('./$.wks')('toStringTag')] = 'z';
if(test + '' != '[object z]'){
  require('./$.redefine')(Object.prototype, 'toString', function toString(){
    return '[object ' + classof(this) + ']';
  }, true);
}
},{"./$.classof":12,"./$.redefine":63,"./$.wks":85}],140:[function(require,module,exports){

var $          = require('./$')
  , LIBRARY    = require('./$.library')
  , global     = require('./$.global')
  , ctx        = require('./$.ctx')
  , classof    = require('./$.classof')
  , $export    = require('./$.export')
  , isObject   = require('./$.is-object')
  , anObject   = require('./$.an-object')
  , aFunction  = require('./$.a-function')
  , strictNew  = require('./$.strict-new')
  , forOf      = require('./$.for-of')
  , setProto   = require('./$.set-proto').set
  , same       = require('./$.same-value')
  , SPECIES    = require('./$.wks')('species')
  , speciesConstructor = require('./$.species-constructor')
  , asap       = require('./$.microtask')
  , PROMISE    = 'Promise'
  , process    = global.process
  , isNode     = classof(process) == 'process'
  , P          = global[PROMISE]
  , Wrapper;

var testResolve = function(sub){
  var test = new P(function(){});
  if(sub)test.constructor = Object;
  return P.resolve(test) === test;
};

var USE_NATIVE = function(){
  var works = false;
  function P2(x){
    var self = new P(x);
    setProto(self, P2.prototype);
    return self;
  }
  try {
    works = P && P.resolve && testResolve();
    setProto(P2, P);
    P2.prototype = $.create(P.prototype, {constructor: {value: P2}});
    // actual Firefox has broken subclass support, test that
    if(!(P2.resolve(5).then(function(){}) instanceof P2)){
      works = false;
    }
    // actual V8 bug, https://code.google.com/p/v8/issues/detail?id=4162
    if(works && require('./$.descriptors')){
      var thenableThenGotten = false;
      P.resolve($.setDesc({}, 'then', {
        get: function(){ thenableThenGotten = true; }
      }));
      works = thenableThenGotten;
    }
  } catch(e){ works = false; }
  return works;
}();

// helpers
var sameConstructor = function(a, b){
  // library wrapper special case
  if(LIBRARY && a === P && b === Wrapper)return true;
  return same(a, b);
};
var getConstructor = function(C){
  var S = anObject(C)[SPECIES];
  return S != undefined ? S : C;
};
var isThenable = function(it){
  var then;
  return isObject(it) && typeof (then = it.then) == 'function' ? then : false;
};
var PromiseCapability = function(C){
  var resolve, reject;
  this.promise = new C(function($$resolve, $$reject){
    if(resolve !== undefined || reject !== undefined)throw TypeError('Bad Promise constructor');
    resolve = $$resolve;
    reject  = $$reject;
  });
  this.resolve = aFunction(resolve),
  this.reject  = aFunction(reject)
};
var perform = function(exec){
  try {
    exec();
  } catch(e){
    return {error: e};
  }
};
var notify = function(record, isReject){
  if(record.n)return;
  record.n = true;
  var chain = record.c;
  asap(function(){
    var value = record.v
      , ok    = record.s == 1
      , i     = 0;
    var run = function(reaction){
      var handler = ok ? reaction.ok : reaction.fail
        , resolve = reaction.resolve
        , reject  = reaction.reject
        , result, then;
      try {
        if(handler){
          if(!ok)record.h = true;
          result = handler === true ? value : handler(value);
          if(result === reaction.promise){
            reject(TypeError('Promise-chain cycle'));
          } else if(then = isThenable(result)){
            then.call(result, resolve, reject);
          } else resolve(result);
        } else reject(value);
      } catch(e){
        reject(e);
      }
    };
    while(chain.length > i)run(chain[i++]); // variable length - can't use forEach
    chain.length = 0;
    record.n = false;
    if(isReject)setTimeout(function(){
      var promise = record.p
        , handler, console;
      if(isUnhandled(promise)){
        if(isNode){
          process.emit('unhandledRejection', value, promise);
        } else if(handler = global.onunhandledrejection){
          handler({promise: promise, reason: value});
        } else if((console = global.console) && console.error){
          console.error('Unhandled promise rejection', value);
        }
      } record.a = undefined;
    }, 1);
  });
};
var isUnhandled = function(promise){
  var record = promise._d
    , chain  = record.a || record.c
    , i      = 0
    , reaction;
  if(record.h)return false;
  while(chain.length > i){
    reaction = chain[i++];
    if(reaction.fail || !isUnhandled(reaction.promise))return false;
  } return true;
};
var $reject = function(value){
  var record = this;
  if(record.d)return;
  record.d = true;
  record = record.r || record; // unwrap
  record.v = value;
  record.s = 2;
  record.a = record.c.slice();
  notify(record, true);
};
var $resolve = function(value){
  var record = this
    , then;
  if(record.d)return;
  record.d = true;
  record = record.r || record; // unwrap
  try {
    if(record.p === value)throw TypeError("Promise can't be resolved itself");
    if(then = isThenable(value)){
      asap(function(){
        var wrapper = {r: record, d: false}; // wrap
        try {
          then.call(value, ctx($resolve, wrapper, 1), ctx($reject, wrapper, 1));
        } catch(e){
          $reject.call(wrapper, e);
        }
      });
    } else {
      record.v = value;
      record.s = 1;
      notify(record, false);
    }
  } catch(e){
    $reject.call({r: record, d: false}, e); // wrap
  }
};

// constructor polyfill
if(!USE_NATIVE){
  // 25.4.3.1 Promise(executor)
  P = function Promise(executor){
    aFunction(executor);
    var record = this._d = {
      p: strictNew(this, P, PROMISE),         // <- promise
      c: [],                                  // <- awaiting reactions
      a: undefined,                           // <- checked in isUnhandled reactions
      s: 0,                                   // <- state
      d: false,                               // <- done
      v: undefined,                           // <- value
      h: false,                               // <- handled rejection
      n: false                                // <- notify
    };
    try {
      executor(ctx($resolve, record, 1), ctx($reject, record, 1));
    } catch(err){
      $reject.call(record, err);
    }
  };
  require('./$.redefine-all')(P.prototype, {
    // 25.4.5.3 Promise.prototype.then(onFulfilled, onRejected)
    then: function then(onFulfilled, onRejected){
      var reaction = new PromiseCapability(speciesConstructor(this, P))
        , promise  = reaction.promise
        , record   = this._d;
      reaction.ok   = typeof onFulfilled == 'function' ? onFulfilled : true;
      reaction.fail = typeof onRejected == 'function' && onRejected;
      record.c.push(reaction);
      if(record.a)record.a.push(reaction);
      if(record.s)notify(record, false);
      return promise;
    },
    // 25.4.5.1 Promise.prototype.catch(onRejected)
    'catch': function(onRejected){
      return this.then(undefined, onRejected);
    }
  });
}

$export($export.G + $export.W + $export.F * !USE_NATIVE, {Promise: P});
require('./$.set-to-string-tag')(P, PROMISE);
require('./$.set-species')(PROMISE);
Wrapper = require('./$.core')[PROMISE];

// statics
$export($export.S + $export.F * !USE_NATIVE, PROMISE, {
  // 25.4.4.5 Promise.reject(r)
  reject: function reject(r){
    var capability = new PromiseCapability(this)
      , $$reject   = capability.reject;
    $$reject(r);
    return capability.promise;
  }
});
$export($export.S + $export.F * (!USE_NATIVE || testResolve(true)), PROMISE, {
  // 25.4.4.6 Promise.resolve(x)
  resolve: function resolve(x){
    // instanceof instead of internal slot check because we should fix it without replacement native Promise core
    if(x instanceof P && sameConstructor(x.constructor, this))return x;
    var capability = new PromiseCapability(this)
      , $$resolve  = capability.resolve;
    $$resolve(x);
    return capability.promise;
  }
});
$export($export.S + $export.F * !(USE_NATIVE && require('./$.iter-detect')(function(iter){
  P.all(iter)['catch'](function(){});
})), PROMISE, {
  // 25.4.4.1 Promise.all(iterable)
  all: function all(iterable){
    var C          = getConstructor(this)
      , capability = new PromiseCapability(C)
      , resolve    = capability.resolve
      , reject     = capability.reject
      , values     = [];
    var abrupt = perform(function(){
      forOf(iterable, false, values.push, values);
      var remaining = values.length
        , results   = Array(remaining);
      if(remaining)$.each.call(values, function(promise, index){
        var alreadyCalled = false;
        C.resolve(promise).then(function(value){
          if(alreadyCalled)return;
          alreadyCalled = true;
          results[index] = value;
          --remaining || resolve(results);
        }, reject);
      });
      else resolve(results);
    });
    if(abrupt)reject(abrupt.error);
    return capability.promise;
  },
  // 25.4.4.4 Promise.race(iterable)
  race: function race(iterable){
    var C          = getConstructor(this)
      , capability = new PromiseCapability(C)
      , reject     = capability.reject;
    var abrupt = perform(function(){
      forOf(iterable, false, function(promise){
        C.resolve(promise).then(capability.resolve, reject);
      });
    });
    if(abrupt)reject(abrupt.error);
    return capability.promise;
  }
});
},{"./$":48,"./$.a-function":4,"./$.an-object":6,"./$.classof":12,"./$.core":18,"./$.ctx":19,"./$.descriptors":21,"./$.export":24,"./$.for-of":29,"./$.global":31,"./$.is-object":40,"./$.iter-detect":45,"./$.library":50,"./$.microtask":54,"./$.redefine-all":62,"./$.same-value":65,"./$.set-proto":66,"./$.set-species":67,"./$.set-to-string-tag":68,"./$.species-constructor":70,"./$.strict-new":71,"./$.wks":85}],141:[function(require,module,exports){
// 26.1.1 Reflect.apply(target, thisArgument, argumentsList)
var $export = require('./$.export')
  , _apply  = Function.apply;

$export($export.S, 'Reflect', {
  apply: function apply(target, thisArgument, argumentsList){
    return _apply.call(target, thisArgument, argumentsList);
  }
});
},{"./$.export":24}],142:[function(require,module,exports){
// 26.1.2 Reflect.construct(target, argumentsList [, newTarget])
var $         = require('./$')
  , $export   = require('./$.export')
  , aFunction = require('./$.a-function')
  , anObject  = require('./$.an-object')
  , isObject  = require('./$.is-object')
  , bind      = Function.bind || require('./$.core').Function.prototype.bind;

// MS Edge supports only 2 arguments
// FF Nightly sets third argument as `new.target`, but does not create `this` from it
$export($export.S + $export.F * require('./$.fails')(function(){
  function F(){}
  return !(Reflect.construct(function(){}, [], F) instanceof F);
}), 'Reflect', {
  construct: function construct(Target, args /*, newTarget*/){
    aFunction(Target);
    var newTarget = arguments.length < 3 ? Target : aFunction(arguments[2]);
    if(Target == newTarget){
      // w/o altered newTarget, optimization for 0-4 arguments
      if(args != undefined)switch(anObject(args).length){
        case 0: return new Target;
        case 1: return new Target(args[0]);
        case 2: return new Target(args[0], args[1]);
        case 3: return new Target(args[0], args[1], args[2]);
        case 4: return new Target(args[0], args[1], args[2], args[3]);
      }
      // w/o altered newTarget, lot of arguments case
      var $args = [null];
      $args.push.apply($args, args);
      return new (bind.apply(Target, $args));
    }
    // with altered newTarget, not support built-in constructors
    var proto    = newTarget.prototype
      , instance = $.create(isObject(proto) ? proto : Object.prototype)
      , result   = Function.apply.call(Target, instance, args);
    return isObject(result) ? result : instance;
  }
});
},{"./$":48,"./$.a-function":4,"./$.an-object":6,"./$.core":18,"./$.export":24,"./$.fails":26,"./$.is-object":40}],143:[function(require,module,exports){
// 26.1.3 Reflect.defineProperty(target, propertyKey, attributes)
var $        = require('./$')
  , $export  = require('./$.export')
  , anObject = require('./$.an-object');

// MS Edge has broken Reflect.defineProperty - throwing instead of returning false
$export($export.S + $export.F * require('./$.fails')(function(){
  Reflect.defineProperty($.setDesc({}, 1, {value: 1}), 1, {value: 2});
}), 'Reflect', {
  defineProperty: function defineProperty(target, propertyKey, attributes){
    anObject(target);
    try {
      $.setDesc(target, propertyKey, attributes);
      return true;
    } catch(e){
      return false;
    }
  }
});
},{"./$":48,"./$.an-object":6,"./$.export":24,"./$.fails":26}],144:[function(require,module,exports){
// 26.1.4 Reflect.deleteProperty(target, propertyKey)
var $export  = require('./$.export')
  , getDesc  = require('./$').getDesc
  , anObject = require('./$.an-object');

$export($export.S, 'Reflect', {
  deleteProperty: function deleteProperty(target, propertyKey){
    var desc = getDesc(anObject(target), propertyKey);
    return desc && !desc.configurable ? false : delete target[propertyKey];
  }
});
},{"./$":48,"./$.an-object":6,"./$.export":24}],145:[function(require,module,exports){

// 26.1.5 Reflect.enumerate(target)
var $export  = require('./$.export')
  , anObject = require('./$.an-object');
var Enumerate = function(iterated){
  this._t = anObject(iterated); // target
  this._i = 0;                  // next index
  var keys = this._k = []       // keys
    , key;
  for(key in iterated)keys.push(key);
};
require('./$.iter-create')(Enumerate, 'Object', function(){
  var that = this
    , keys = that._k
    , key;
  do {
    if(that._i >= keys.length)return {value: undefined, done: true};
  } while(!((key = keys[that._i++]) in that._t));
  return {value: key, done: false};
});

$export($export.S, 'Reflect', {
  enumerate: function enumerate(target){
    return new Enumerate(target);
  }
});
},{"./$.an-object":6,"./$.export":24,"./$.iter-create":43}],146:[function(require,module,exports){
// 26.1.7 Reflect.getOwnPropertyDescriptor(target, propertyKey)
var $        = require('./$')
  , $export  = require('./$.export')
  , anObject = require('./$.an-object');

$export($export.S, 'Reflect', {
  getOwnPropertyDescriptor: function getOwnPropertyDescriptor(target, propertyKey){
    return $.getDesc(anObject(target), propertyKey);
  }
});
},{"./$":48,"./$.an-object":6,"./$.export":24}],147:[function(require,module,exports){
// 26.1.8 Reflect.getPrototypeOf(target)
var $export  = require('./$.export')
  , getProto = require('./$').getProto
  , anObject = require('./$.an-object');

$export($export.S, 'Reflect', {
  getPrototypeOf: function getPrototypeOf(target){
    return getProto(anObject(target));
  }
});
},{"./$":48,"./$.an-object":6,"./$.export":24}],148:[function(require,module,exports){
// 26.1.6 Reflect.get(target, propertyKey [, receiver])
var $        = require('./$')
  , has      = require('./$.has')
  , $export  = require('./$.export')
  , isObject = require('./$.is-object')
  , anObject = require('./$.an-object');

function get(target, propertyKey/*, receiver*/){
  var receiver = arguments.length < 3 ? target : arguments[2]
    , desc, proto;
  if(anObject(target) === receiver)return target[propertyKey];
  if(desc = $.getDesc(target, propertyKey))return has(desc, 'value')
    ? desc.value
    : desc.get !== undefined
      ? desc.get.call(receiver)
      : undefined;
  if(isObject(proto = $.getProto(target)))return get(proto, propertyKey, receiver);
}

$export($export.S, 'Reflect', {get: get});
},{"./$":48,"./$.an-object":6,"./$.export":24,"./$.has":32,"./$.is-object":40}],149:[function(require,module,exports){
// 26.1.9 Reflect.has(target, propertyKey)
var $export = require('./$.export');

$export($export.S, 'Reflect', {
  has: function has(target, propertyKey){
    return propertyKey in target;
  }
});
},{"./$.export":24}],150:[function(require,module,exports){
// 26.1.10 Reflect.isExtensible(target)
var $export       = require('./$.export')
  , anObject      = require('./$.an-object')
  , $isExtensible = Object.isExtensible;

$export($export.S, 'Reflect', {
  isExtensible: function isExtensible(target){
    anObject(target);
    return $isExtensible ? $isExtensible(target) : true;
  }
});
},{"./$.an-object":6,"./$.export":24}],151:[function(require,module,exports){
// 26.1.11 Reflect.ownKeys(target)
var $export = require('./$.export');

$export($export.S, 'Reflect', {ownKeys: require('./$.own-keys')});
},{"./$.export":24,"./$.own-keys":58}],152:[function(require,module,exports){
// 26.1.12 Reflect.preventExtensions(target)
var $export            = require('./$.export')
  , anObject           = require('./$.an-object')
  , $preventExtensions = Object.preventExtensions;

$export($export.S, 'Reflect', {
  preventExtensions: function preventExtensions(target){
    anObject(target);
    try {
      if($preventExtensions)$preventExtensions(target);
      return true;
    } catch(e){
      return false;
    }
  }
});
},{"./$.an-object":6,"./$.export":24}],153:[function(require,module,exports){
// 26.1.14 Reflect.setPrototypeOf(target, proto)
var $export  = require('./$.export')
  , setProto = require('./$.set-proto');

if(setProto)$export($export.S, 'Reflect', {
  setPrototypeOf: function setPrototypeOf(target, proto){
    setProto.check(target, proto);
    try {
      setProto.set(target, proto);
      return true;
    } catch(e){
      return false;
    }
  }
});
},{"./$.export":24,"./$.set-proto":66}],154:[function(require,module,exports){
// 26.1.13 Reflect.set(target, propertyKey, V [, receiver])
var $          = require('./$')
  , has        = require('./$.has')
  , $export    = require('./$.export')
  , createDesc = require('./$.property-desc')
  , anObject   = require('./$.an-object')
  , isObject   = require('./$.is-object');

function set(target, propertyKey, V/*, receiver*/){
  var receiver = arguments.length < 4 ? target : arguments[3]
    , ownDesc  = $.getDesc(anObject(target), propertyKey)
    , existingDescriptor, proto;
  if(!ownDesc){
    if(isObject(proto = $.getProto(target))){
      return set(proto, propertyKey, V, receiver);
    }
    ownDesc = createDesc(0);
  }
  if(has(ownDesc, 'value')){
    if(ownDesc.writable === false || !isObject(receiver))return false;
    existingDescriptor = $.getDesc(receiver, propertyKey) || createDesc(0);
    existingDescriptor.value = V;
    $.setDesc(receiver, propertyKey, existingDescriptor);
    return true;
  }
  return ownDesc.set === undefined ? false : (ownDesc.set.call(receiver, V), true);
}

$export($export.S, 'Reflect', {set: set});
},{"./$":48,"./$.an-object":6,"./$.export":24,"./$.has":32,"./$.is-object":40,"./$.property-desc":61}],155:[function(require,module,exports){
var $        = require('./$')
  , global   = require('./$.global')
  , isRegExp = require('./$.is-regexp')
  , $flags   = require('./$.flags')
  , $RegExp  = global.RegExp
  , Base     = $RegExp
  , proto    = $RegExp.prototype
  , re1      = /a/g
  , re2      = /a/g
  // "new" creates a new object, old webkit buggy here
  , CORRECT_NEW = new $RegExp(re1) !== re1;

if(require('./$.descriptors') && (!CORRECT_NEW || require('./$.fails')(function(){
  re2[require('./$.wks')('match')] = false;
  // RegExp constructor can alter flags and IsRegExp works correct with @@match
  return $RegExp(re1) != re1 || $RegExp(re2) == re2 || $RegExp(re1, 'i') != '/a/i';
}))){
  $RegExp = function RegExp(p, f){
    var piRE = isRegExp(p)
      , fiU  = f === undefined;
    return !(this instanceof $RegExp) && piRE && p.constructor === $RegExp && fiU ? p
      : CORRECT_NEW
        ? new Base(piRE && !fiU ? p.source : p, f)
        : Base((piRE = p instanceof $RegExp) ? p.source : p, piRE && fiU ? $flags.call(p) : f);
  };
  $.each.call($.getNames(Base), function(key){
    key in $RegExp || $.setDesc($RegExp, key, {
      configurable: true,
      get: function(){ return Base[key]; },
      set: function(it){ Base[key] = it; }
    });
  });
  proto.constructor = $RegExp;
  $RegExp.prototype = proto;
  require('./$.redefine')(global, 'RegExp', $RegExp);
}

require('./$.set-species')('RegExp');
},{"./$":48,"./$.descriptors":21,"./$.fails":26,"./$.flags":28,"./$.global":31,"./$.is-regexp":41,"./$.redefine":63,"./$.set-species":67,"./$.wks":85}],156:[function(require,module,exports){
// 21.2.5.3 get RegExp.prototype.flags()
var $ = require('./$');
if(require('./$.descriptors') && /./g.flags != 'g')$.setDesc(RegExp.prototype, 'flags', {
  configurable: true,
  get: require('./$.flags')
});
},{"./$":48,"./$.descriptors":21,"./$.flags":28}],157:[function(require,module,exports){
// @@match logic
require('./$.fix-re-wks')('match', 1, function(defined, MATCH){
  // 21.1.3.11 String.prototype.match(regexp)
  return function match(regexp){
    'use strict';
    var O  = defined(this)
      , fn = regexp == undefined ? undefined : regexp[MATCH];
    return fn !== undefined ? fn.call(regexp, O) : new RegExp(regexp)[MATCH](String(O));
  };
});
},{"./$.fix-re-wks":27}],158:[function(require,module,exports){
// @@replace logic
require('./$.fix-re-wks')('replace', 2, function(defined, REPLACE, $replace){
  // 21.1.3.14 String.prototype.replace(searchValue, replaceValue)
  return function replace(searchValue, replaceValue){
    'use strict';
    var O  = defined(this)
      , fn = searchValue == undefined ? undefined : searchValue[REPLACE];
    return fn !== undefined
      ? fn.call(searchValue, O, replaceValue)
      : $replace.call(String(O), searchValue, replaceValue);
  };
});
},{"./$.fix-re-wks":27}],159:[function(require,module,exports){
// @@search logic
require('./$.fix-re-wks')('search', 1, function(defined, SEARCH){
  // 21.1.3.15 String.prototype.search(regexp)
  return function search(regexp){
    'use strict';
    var O  = defined(this)
      , fn = regexp == undefined ? undefined : regexp[SEARCH];
    return fn !== undefined ? fn.call(regexp, O) : new RegExp(regexp)[SEARCH](String(O));
  };
});
},{"./$.fix-re-wks":27}],160:[function(require,module,exports){
// @@split logic
require('./$.fix-re-wks')('split', 2, function(defined, SPLIT, $split){
  // 21.1.3.17 String.prototype.split(separator, limit)
  return function split(separator, limit){
    'use strict';
    var O  = defined(this)
      , fn = separator == undefined ? undefined : separator[SPLIT];
    return fn !== undefined
      ? fn.call(separator, O, limit)
      : $split.call(String(O), separator, limit);
  };
});
},{"./$.fix-re-wks":27}],161:[function(require,module,exports){

var strong = require('./$.collection-strong');

// 23.2 Set Objects
require('./$.collection')('Set', function(get){
  return function Set(){ return get(this, arguments.length > 0 ? arguments[0] : undefined); };
}, {
  // 23.2.3.1 Set.prototype.add(value)
  add: function add(value){
    return strong.def(this, value = value === 0 ? 0 : value, value);
  }
}, strong);
},{"./$.collection":17,"./$.collection-strong":14}],162:[function(require,module,exports){

var $export = require('./$.export')
  , $at     = require('./$.string-at')(false);
$export($export.P, 'String', {
  // 21.1.3.3 String.prototype.codePointAt(pos)
  codePointAt: function codePointAt(pos){
    return $at(this, pos);
  }
});
},{"./$.export":24,"./$.string-at":72}],163:[function(require,module,exports){
// 21.1.3.6 String.prototype.endsWith(searchString [, endPosition])

var $export   = require('./$.export')
  , toLength  = require('./$.to-length')
  , context   = require('./$.string-context')
  , ENDS_WITH = 'endsWith'
  , $endsWith = ''[ENDS_WITH];

$export($export.P + $export.F * require('./$.fails-is-regexp')(ENDS_WITH), 'String', {
  endsWith: function endsWith(searchString /*, endPosition = @length */){
    var that = context(this, searchString, ENDS_WITH)
      , $$   = arguments
      , endPosition = $$.length > 1 ? $$[1] : undefined
      , len    = toLength(that.length)
      , end    = endPosition === undefined ? len : Math.min(toLength(endPosition), len)
      , search = String(searchString);
    return $endsWith
      ? $endsWith.call(that, search, end)
      : that.slice(end - search.length, end) === search;
  }
});
},{"./$.export":24,"./$.fails-is-regexp":25,"./$.string-context":73,"./$.to-length":81}],164:[function(require,module,exports){
var $export        = require('./$.export')
  , toIndex        = require('./$.to-index')
  , fromCharCode   = String.fromCharCode
  , $fromCodePoint = String.fromCodePoint;

// length should be 1, old FF problem
$export($export.S + $export.F * (!!$fromCodePoint && $fromCodePoint.length != 1), 'String', {
  // 21.1.2.2 String.fromCodePoint(...codePoints)
  fromCodePoint: function fromCodePoint(x){ // eslint-disable-line no-unused-vars
    var res   = []
      , $$    = arguments
      , $$len = $$.length
      , i     = 0
      , code;
    while($$len > i){
      code = +$$[i++];
      if(toIndex(code, 0x10ffff) !== code)throw RangeError(code + ' is not a valid code point');
      res.push(code < 0x10000
        ? fromCharCode(code)
        : fromCharCode(((code -= 0x10000) >> 10) + 0xd800, code % 0x400 + 0xdc00)
      );
    } return res.join('');
  }
});
},{"./$.export":24,"./$.to-index":78}],165:[function(require,module,exports){
// 21.1.3.7 String.prototype.includes(searchString, position = 0)

var $export  = require('./$.export')
  , context  = require('./$.string-context')
  , INCLUDES = 'includes';

$export($export.P + $export.F * require('./$.fails-is-regexp')(INCLUDES), 'String', {
  includes: function includes(searchString /*, position = 0 */){
    return !!~context(this, searchString, INCLUDES)
      .indexOf(searchString, arguments.length > 1 ? arguments[1] : undefined);
  }
});
},{"./$.export":24,"./$.fails-is-regexp":25,"./$.string-context":73}],166:[function(require,module,exports){

var $at  = require('./$.string-at')(true);

// 21.1.3.27 String.prototype[@@iterator]()
require('./$.iter-define')(String, 'String', function(iterated){
  this._t = String(iterated); // target
  this._i = 0;                // next index
// 21.1.5.2.1 %StringIteratorPrototype%.next()
}, function(){
  var O     = this._t
    , index = this._i
    , point;
  if(index >= O.length)return {value: undefined, done: true};
  point = $at(O, index);
  this._i += point.length;
  return {value: point, done: false};
});
},{"./$.iter-define":44,"./$.string-at":72}],167:[function(require,module,exports){
var $export   = require('./$.export')
  , toIObject = require('./$.to-iobject')
  , toLength  = require('./$.to-length');

$export($export.S, 'String', {
  // 21.1.2.4 String.raw(callSite, ...substitutions)
  raw: function raw(callSite){
    var tpl   = toIObject(callSite.raw)
      , len   = toLength(tpl.length)
      , $$    = arguments
      , $$len = $$.length
      , res   = []
      , i     = 0;
    while(len > i){
      res.push(String(tpl[i++]));
      if(i < $$len)res.push(String($$[i]));
    } return res.join('');
  }
});
},{"./$.export":24,"./$.to-iobject":80,"./$.to-length":81}],168:[function(require,module,exports){
var $export = require('./$.export');

$export($export.P, 'String', {
  // 21.1.3.13 String.prototype.repeat(count)
  repeat: require('./$.string-repeat')
});
},{"./$.export":24,"./$.string-repeat":75}],169:[function(require,module,exports){
// 21.1.3.18 String.prototype.startsWith(searchString [, position ])

var $export     = require('./$.export')
  , toLength    = require('./$.to-length')
  , context     = require('./$.string-context')
  , STARTS_WITH = 'startsWith'
  , $startsWith = ''[STARTS_WITH];

$export($export.P + $export.F * require('./$.fails-is-regexp')(STARTS_WITH), 'String', {
  startsWith: function startsWith(searchString /*, position = 0 */){
    var that   = context(this, searchString, STARTS_WITH)
      , $$     = arguments
      , index  = toLength(Math.min($$.length > 1 ? $$[1] : undefined, that.length))
      , search = String(searchString);
    return $startsWith
      ? $startsWith.call(that, search, index)
      : that.slice(index, index + search.length) === search;
  }
});
},{"./$.export":24,"./$.fails-is-regexp":25,"./$.string-context":73,"./$.to-length":81}],170:[function(require,module,exports){

// 21.1.3.25 String.prototype.trim()
require('./$.string-trim')('trim', function($trim){
  return function trim(){
    return $trim(this, 3);
  };
});
},{"./$.string-trim":76}],171:[function(require,module,exports){

// ECMAScript 6 symbols shim
var $              = require('./$')
  , global         = require('./$.global')
  , has            = require('./$.has')
  , DESCRIPTORS    = require('./$.descriptors')
  , $export        = require('./$.export')
  , redefine       = require('./$.redefine')
  , $fails         = require('./$.fails')
  , shared         = require('./$.shared')
  , setToStringTag = require('./$.set-to-string-tag')
  , uid            = require('./$.uid')
  , wks            = require('./$.wks')
  , keyOf          = require('./$.keyof')
  , $names         = require('./$.get-names')
  , enumKeys       = require('./$.enum-keys')
  , isArray        = require('./$.is-array')
  , anObject       = require('./$.an-object')
  , toIObject      = require('./$.to-iobject')
  , createDesc     = require('./$.property-desc')
  , getDesc        = $.getDesc
  , setDesc        = $.setDesc
  , _create        = $.create
  , getNames       = $names.get
  , $Symbol        = global.Symbol
  , $JSON          = global.JSON
  , _stringify     = $JSON && $JSON.stringify
  , setter         = false
  , HIDDEN         = wks('_hidden')
  , isEnum         = $.isEnum
  , SymbolRegistry = shared('symbol-registry')
  , AllSymbols     = shared('symbols')
  , useNative      = typeof $Symbol == 'function'
  , ObjectProto    = Object.prototype;

// fallback for old Android, https://code.google.com/p/v8/issues/detail?id=687
var setSymbolDesc = DESCRIPTORS && $fails(function(){
  return _create(setDesc({}, 'a', {
    get: function(){ return setDesc(this, 'a', {value: 7}).a; }
  })).a != 7;
}) ? function(it, key, D){
  var protoDesc = getDesc(ObjectProto, key);
  if(protoDesc)delete ObjectProto[key];
  setDesc(it, key, D);
  if(protoDesc && it !== ObjectProto)setDesc(ObjectProto, key, protoDesc);
} : setDesc;

var wrap = function(tag){
  var sym = AllSymbols[tag] = _create($Symbol.prototype);
  sym._k = tag;
  DESCRIPTORS && setter && setSymbolDesc(ObjectProto, tag, {
    configurable: true,
    set: function(value){
      if(has(this, HIDDEN) && has(this[HIDDEN], tag))this[HIDDEN][tag] = false;
      setSymbolDesc(this, tag, createDesc(1, value));
    }
  });
  return sym;
};

var isSymbol = function(it){
  return typeof it == 'symbol';
};

var $defineProperty = function defineProperty(it, key, D){
  if(D && has(AllSymbols, key)){
    if(!D.enumerable){
      if(!has(it, HIDDEN))setDesc(it, HIDDEN, createDesc(1, {}));
      it[HIDDEN][key] = true;
    } else {
      if(has(it, HIDDEN) && it[HIDDEN][key])it[HIDDEN][key] = false;
      D = _create(D, {enumerable: createDesc(0, false)});
    } return setSymbolDesc(it, key, D);
  } return setDesc(it, key, D);
};
var $defineProperties = function defineProperties(it, P){
  anObject(it);
  var keys = enumKeys(P = toIObject(P))
    , i    = 0
    , l = keys.length
    , key;
  while(l > i)$defineProperty(it, key = keys[i++], P[key]);
  return it;
};
var $create = function create(it, P){
  return P === undefined ? _create(it) : $defineProperties(_create(it), P);
};
var $propertyIsEnumerable = function propertyIsEnumerable(key){
  var E = isEnum.call(this, key);
  return E || !has(this, key) || !has(AllSymbols, key) || has(this, HIDDEN) && this[HIDDEN][key]
    ? E : true;
};
var $getOwnPropertyDescriptor = function getOwnPropertyDescriptor(it, key){
  var D = getDesc(it = toIObject(it), key);
  if(D && has(AllSymbols, key) && !(has(it, HIDDEN) && it[HIDDEN][key]))D.enumerable = true;
  return D;
};
var $getOwnPropertyNames = function getOwnPropertyNames(it){
  var names  = getNames(toIObject(it))
    , result = []
    , i      = 0
    , key;
  while(names.length > i)if(!has(AllSymbols, key = names[i++]) && key != HIDDEN)result.push(key);
  return result;
};
var $getOwnPropertySymbols = function getOwnPropertySymbols(it){
  var names  = getNames(toIObject(it))
    , result = []
    , i      = 0
    , key;
  while(names.length > i)if(has(AllSymbols, key = names[i++]))result.push(AllSymbols[key]);
  return result;
};
var $stringify = function stringify(it){
  if(it === undefined || isSymbol(it))return; // IE8 returns string on undefined
  var args = [it]
    , i    = 1
    , $$   = arguments
    , replacer, $replacer;
  while($$.length > i)args.push($$[i++]);
  replacer = args[1];
  if(typeof replacer == 'function')$replacer = replacer;
  if($replacer || !isArray(replacer))replacer = function(key, value){
    if($replacer)value = $replacer.call(this, key, value);
    if(!isSymbol(value))return value;
  };
  args[1] = replacer;
  return _stringify.apply($JSON, args);
};
var buggyJSON = $fails(function(){
  var S = $Symbol();
  // MS Edge converts symbol values to JSON as {}
  // WebKit converts symbol values to JSON as null
  // V8 throws on boxed symbols
  return _stringify([S]) != '[null]' || _stringify({a: S}) != '{}' || _stringify(Object(S)) != '{}';
});

// 19.4.1.1 Symbol([description])
if(!useNative){
  $Symbol = function Symbol(){
    if(isSymbol(this))throw TypeError('Symbol is not a constructor');
    return wrap(uid(arguments.length > 0 ? arguments[0] : undefined));
  };
  redefine($Symbol.prototype, 'toString', function toString(){
    return this._k;
  });

  isSymbol = function(it){
    return it instanceof $Symbol;
  };

  $.create     = $create;
  $.isEnum     = $propertyIsEnumerable;
  $.getDesc    = $getOwnPropertyDescriptor;
  $.setDesc    = $defineProperty;
  $.setDescs   = $defineProperties;
  $.getNames   = $names.get = $getOwnPropertyNames;
  $.getSymbols = $getOwnPropertySymbols;

  if(DESCRIPTORS && !require('./$.library')){
    redefine(ObjectProto, 'propertyIsEnumerable', $propertyIsEnumerable, true);
  }
}

var symbolStatics = {
  // 19.4.2.1 Symbol.for(key)
  'for': function(key){
    return has(SymbolRegistry, key += '')
      ? SymbolRegistry[key]
      : SymbolRegistry[key] = $Symbol(key);
  },
  // 19.4.2.5 Symbol.keyFor(sym)
  keyFor: function keyFor(key){
    return keyOf(SymbolRegistry, key);
  },
  useSetter: function(){ setter = true; },
  useSimple: function(){ setter = false; }
};
// 19.4.2.2 Symbol.hasInstance
// 19.4.2.3 Symbol.isConcatSpreadable
// 19.4.2.4 Symbol.iterator
// 19.4.2.6 Symbol.match
// 19.4.2.8 Symbol.replace
// 19.4.2.9 Symbol.search
// 19.4.2.10 Symbol.species
// 19.4.2.11 Symbol.split
// 19.4.2.12 Symbol.toPrimitive
// 19.4.2.13 Symbol.toStringTag
// 19.4.2.14 Symbol.unscopables
$.each.call((
  'hasInstance,isConcatSpreadable,iterator,match,replace,search,' +
  'species,split,toPrimitive,toStringTag,unscopables'
).split(','), function(it){
  var sym = wks(it);
  symbolStatics[it] = useNative ? sym : wrap(sym);
});

setter = true;

$export($export.G + $export.W, {Symbol: $Symbol});

$export($export.S, 'Symbol', symbolStatics);

$export($export.S + $export.F * !useNative, 'Object', {
  // 19.1.2.2 Object.create(O [, Properties])
  create: $create,
  // 19.1.2.4 Object.defineProperty(O, P, Attributes)
  defineProperty: $defineProperty,
  // 19.1.2.3 Object.defineProperties(O, Properties)
  defineProperties: $defineProperties,
  // 19.1.2.6 Object.getOwnPropertyDescriptor(O, P)
  getOwnPropertyDescriptor: $getOwnPropertyDescriptor,
  // 19.1.2.7 Object.getOwnPropertyNames(O)
  getOwnPropertyNames: $getOwnPropertyNames,
  // 19.1.2.8 Object.getOwnPropertySymbols(O)
  getOwnPropertySymbols: $getOwnPropertySymbols
});

// 24.3.2 JSON.stringify(value [, replacer [, space]])
$JSON && $export($export.S + $export.F * (!useNative || buggyJSON), 'JSON', {stringify: $stringify});

// 19.4.3.5 Symbol.prototype[@@toStringTag]
setToStringTag($Symbol, 'Symbol');
// 20.2.1.9 Math[@@toStringTag]
setToStringTag(Math, 'Math', true);
// 24.3.3 JSON[@@toStringTag]
setToStringTag(global.JSON, 'JSON', true);
},{"./$":48,"./$.an-object":6,"./$.descriptors":21,"./$.enum-keys":23,"./$.export":24,"./$.fails":26,"./$.get-names":30,"./$.global":31,"./$.has":32,"./$.is-array":38,"./$.keyof":49,"./$.library":50,"./$.property-desc":61,"./$.redefine":63,"./$.set-to-string-tag":68,"./$.shared":69,"./$.to-iobject":80,"./$.uid":84,"./$.wks":85}],172:[function(require,module,exports){

var $            = require('./$')
  , redefine     = require('./$.redefine')
  , weak         = require('./$.collection-weak')
  , isObject     = require('./$.is-object')
  , has          = require('./$.has')
  , frozenStore  = weak.frozenStore
  , WEAK         = weak.WEAK
  , isExtensible = Object.isExtensible || isObject
  , tmp          = {};

// 23.3 WeakMap Objects
var $WeakMap = require('./$.collection')('WeakMap', function(get){
  return function WeakMap(){ return get(this, arguments.length > 0 ? arguments[0] : undefined); };
}, {
  // 23.3.3.3 WeakMap.prototype.get(key)
  get: function get(key){
    if(isObject(key)){
      if(!isExtensible(key))return frozenStore(this).get(key);
      if(has(key, WEAK))return key[WEAK][this._i];
    }
  },
  // 23.3.3.5 WeakMap.prototype.set(key, value)
  set: function set(key, value){
    return weak.def(this, key, value);
  }
}, weak, true, true);

// IE11 WeakMap frozen keys fix
if(new $WeakMap().set((Object.freeze || Object)(tmp), 7).get(tmp) != 7){
  $.each.call(['delete', 'has', 'get', 'set'], function(key){
    var proto  = $WeakMap.prototype
      , method = proto[key];
    redefine(proto, key, function(a, b){
      // store frozen objects on leaky map
      if(isObject(a) && !isExtensible(a)){
        var result = frozenStore(this)[key](a, b);
        return key == 'set' ? this : result;
      // store all the rest on native weakmap
      } return method.call(this, a, b);
    });
  });
}
},{"./$":48,"./$.collection":17,"./$.collection-weak":16,"./$.has":32,"./$.is-object":40,"./$.redefine":63}],173:[function(require,module,exports){

var weak = require('./$.collection-weak');

// 23.4 WeakSet Objects
require('./$.collection')('WeakSet', function(get){
  return function WeakSet(){ return get(this, arguments.length > 0 ? arguments[0] : undefined); };
}, {
  // 23.4.3.1 WeakSet.prototype.add(value)
  add: function add(value){
    return weak.def(this, value, true);
  }
}, weak, false, true);
},{"./$.collection":17,"./$.collection-weak":16}],174:[function(require,module,exports){

var $export   = require('./$.export')
  , $includes = require('./$.array-includes')(true);

$export($export.P, 'Array', {
  // https://github.com/domenic/Array.prototype.includes
  includes: function includes(el /*, fromIndex = 0 */){
    return $includes(this, el, arguments.length > 1 ? arguments[1] : undefined);
  }
});

require('./$.add-to-unscopables')('includes');
},{"./$.add-to-unscopables":5,"./$.array-includes":9,"./$.export":24}],175:[function(require,module,exports){
// https://github.com/DavidBruant/Map-Set.prototype.toJSON
var $export  = require('./$.export');

$export($export.P, 'Map', {toJSON: require('./$.collection-to-json')('Map')});
},{"./$.collection-to-json":15,"./$.export":24}],176:[function(require,module,exports){
// http://goo.gl/XkBrjD
var $export  = require('./$.export')
  , $entries = require('./$.object-to-array')(true);

$export($export.S, 'Object', {
  entries: function entries(it){
    return $entries(it);
  }
});
},{"./$.export":24,"./$.object-to-array":57}],177:[function(require,module,exports){
// https://gist.github.com/WebReflection/9353781
var $          = require('./$')
  , $export    = require('./$.export')
  , ownKeys    = require('./$.own-keys')
  , toIObject  = require('./$.to-iobject')
  , createDesc = require('./$.property-desc');

$export($export.S, 'Object', {
  getOwnPropertyDescriptors: function getOwnPropertyDescriptors(object){
    var O       = toIObject(object)
      , setDesc = $.setDesc
      , getDesc = $.getDesc
      , keys    = ownKeys(O)
      , result  = {}
      , i       = 0
      , key, D;
    while(keys.length > i){
      D = getDesc(O, key = keys[i++]);
      if(key in result)setDesc(result, key, createDesc(0, D));
      else result[key] = D;
    } return result;
  }
});
},{"./$":48,"./$.export":24,"./$.own-keys":58,"./$.property-desc":61,"./$.to-iobject":80}],178:[function(require,module,exports){
// http://goo.gl/XkBrjD
var $export = require('./$.export')
  , $values = require('./$.object-to-array')(false);

$export($export.S, 'Object', {
  values: function values(it){
    return $values(it);
  }
});
},{"./$.export":24,"./$.object-to-array":57}],179:[function(require,module,exports){
// https://github.com/benjamingr/RexExp.escape
var $export = require('./$.export')
  , $re     = require('./$.replacer')(/[\\^$*+?.()|[\]{}]/g, '\\$&');

$export($export.S, 'RegExp', {escape: function escape(it){ return $re(it); }});

},{"./$.export":24,"./$.replacer":64}],180:[function(require,module,exports){
// https://github.com/DavidBruant/Map-Set.prototype.toJSON
var $export  = require('./$.export');

$export($export.P, 'Set', {toJSON: require('./$.collection-to-json')('Set')});
},{"./$.collection-to-json":15,"./$.export":24}],181:[function(require,module,exports){

// https://github.com/mathiasbynens/String.prototype.at
var $export = require('./$.export')
  , $at     = require('./$.string-at')(true);

$export($export.P, 'String', {
  at: function at(pos){
    return $at(this, pos);
  }
});
},{"./$.export":24,"./$.string-at":72}],182:[function(require,module,exports){

var $export = require('./$.export')
  , $pad    = require('./$.string-pad');

$export($export.P, 'String', {
  padLeft: function padLeft(maxLength /*, fillString = ' ' */){
    return $pad(this, maxLength, arguments.length > 1 ? arguments[1] : undefined, true);
  }
});
},{"./$.export":24,"./$.string-pad":74}],183:[function(require,module,exports){

var $export = require('./$.export')
  , $pad    = require('./$.string-pad');

$export($export.P, 'String', {
  padRight: function padRight(maxLength /*, fillString = ' ' */){
    return $pad(this, maxLength, arguments.length > 1 ? arguments[1] : undefined, false);
  }
});
},{"./$.export":24,"./$.string-pad":74}],184:[function(require,module,exports){

// https://github.com/sebmarkbage/ecmascript-string-left-right-trim
require('./$.string-trim')('trimLeft', function($trim){
  return function trimLeft(){
    return $trim(this, 1);
  };
});
},{"./$.string-trim":76}],185:[function(require,module,exports){

// https://github.com/sebmarkbage/ecmascript-string-left-right-trim
require('./$.string-trim')('trimRight', function($trim){
  return function trimRight(){
    return $trim(this, 2);
  };
});
},{"./$.string-trim":76}],186:[function(require,module,exports){
// JavaScript 1.6 / Strawman array statics shim
var $       = require('./$')
  , $export = require('./$.export')
  , $ctx    = require('./$.ctx')
  , $Array  = require('./$.core').Array || Array
  , statics = {};
var setStatics = function(keys, length){
  $.each.call(keys.split(','), function(key){
    if(length == undefined && key in $Array)statics[key] = $Array[key];
    else if(key in [])statics[key] = $ctx(Function.call, [][key], length);
  });
};
setStatics('pop,reverse,shift,keys,values,entries', 1);
setStatics('indexOf,every,some,forEach,map,filter,find,findIndex,includes', 3);
setStatics('join,slice,concat,push,splice,unshift,sort,lastIndexOf,' +
           'reduce,reduceRight,copyWithin,fill');
$export($export.S, 'Array', statics);
},{"./$":48,"./$.core":18,"./$.ctx":19,"./$.export":24}],187:[function(require,module,exports){
require('./es6.array.iterator');
var global      = require('./$.global')
  , hide        = require('./$.hide')
  , Iterators   = require('./$.iterators')
  , ITERATOR    = require('./$.wks')('iterator')
  , NL          = global.NodeList
  , HTC         = global.HTMLCollection
  , NLProto     = NL && NL.prototype
  , HTCProto    = HTC && HTC.prototype
  , ArrayValues = Iterators.NodeList = Iterators.HTMLCollection = Iterators.Array;
if(NLProto && !NLProto[ITERATOR])hide(NLProto, ITERATOR, ArrayValues);
if(HTCProto && !HTCProto[ITERATOR])hide(HTCProto, ITERATOR, ArrayValues);
},{"./$.global":31,"./$.hide":33,"./$.iterators":47,"./$.wks":85,"./es6.array.iterator":93}],188:[function(require,module,exports){
var $export = require('./$.export')
  , $task   = require('./$.task');
$export($export.G + $export.B, {
  setImmediate:   $task.set,
  clearImmediate: $task.clear
});
},{"./$.export":24,"./$.task":77}],189:[function(require,module,exports){
// ie9- setTimeout & setInterval additional parameters fix
var global     = require('./$.global')
  , $export    = require('./$.export')
  , invoke     = require('./$.invoke')
  , partial    = require('./$.partial')
  , navigator  = global.navigator
  , MSIE       = !!navigator && /MSIE .\./.test(navigator.userAgent); // <- dirty ie9- check
var wrap = function(set){
  return MSIE ? function(fn, time /*, ...args */){
    return set(invoke(
      partial,
      [].slice.call(arguments, 2),
      typeof fn == 'function' ? fn : Function(fn)
    ), time);
  } : set;
};
$export($export.G + $export.B + $export.F * MSIE, {
  setTimeout:  wrap(global.setTimeout),
  setInterval: wrap(global.setInterval)
});
},{"./$.export":24,"./$.global":31,"./$.invoke":35,"./$.partial":59}],190:[function(require,module,exports){
require('./modules/es5');
require('./modules/es6.symbol');
require('./modules/es6.object.assign');
require('./modules/es6.object.is');
require('./modules/es6.object.set-prototype-of');
require('./modules/es6.object.to-string');
require('./modules/es6.object.freeze');
require('./modules/es6.object.seal');
require('./modules/es6.object.prevent-extensions');
require('./modules/es6.object.is-frozen');
require('./modules/es6.object.is-sealed');
require('./modules/es6.object.is-extensible');
require('./modules/es6.object.get-own-property-descriptor');
require('./modules/es6.object.get-prototype-of');
require('./modules/es6.object.keys');
require('./modules/es6.object.get-own-property-names');
require('./modules/es6.function.name');
require('./modules/es6.function.has-instance');
require('./modules/es6.number.constructor');
require('./modules/es6.number.epsilon');
require('./modules/es6.number.is-finite');
require('./modules/es6.number.is-integer');
require('./modules/es6.number.is-nan');
require('./modules/es6.number.is-safe-integer');
require('./modules/es6.number.max-safe-integer');
require('./modules/es6.number.min-safe-integer');
require('./modules/es6.number.parse-float');
require('./modules/es6.number.parse-int');
require('./modules/es6.math.acosh');
require('./modules/es6.math.asinh');
require('./modules/es6.math.atanh');
require('./modules/es6.math.cbrt');
require('./modules/es6.math.clz32');
require('./modules/es6.math.cosh');
require('./modules/es6.math.expm1');
require('./modules/es6.math.fround');
require('./modules/es6.math.hypot');
require('./modules/es6.math.imul');
require('./modules/es6.math.log10');
require('./modules/es6.math.log1p');
require('./modules/es6.math.log2');
require('./modules/es6.math.sign');
require('./modules/es6.math.sinh');
require('./modules/es6.math.tanh');
require('./modules/es6.math.trunc');
require('./modules/es6.string.from-code-point');
require('./modules/es6.string.raw');
require('./modules/es6.string.trim');
require('./modules/es6.string.iterator');
require('./modules/es6.string.code-point-at');
require('./modules/es6.string.ends-with');
require('./modules/es6.string.includes');
require('./modules/es6.string.repeat');
require('./modules/es6.string.starts-with');
require('./modules/es6.array.from');
require('./modules/es6.array.of');
require('./modules/es6.array.iterator');
require('./modules/es6.array.species');
require('./modules/es6.array.copy-within');
require('./modules/es6.array.fill');
require('./modules/es6.array.find');
require('./modules/es6.array.find-index');
require('./modules/es6.regexp.constructor');
require('./modules/es6.regexp.flags');
require('./modules/es6.regexp.match');
require('./modules/es6.regexp.replace');
require('./modules/es6.regexp.search');
require('./modules/es6.regexp.split');
require('./modules/es6.promise');
require('./modules/es6.map');
require('./modules/es6.set');
require('./modules/es6.weak-map');
require('./modules/es6.weak-set');
require('./modules/es6.reflect.apply');
require('./modules/es6.reflect.construct');
require('./modules/es6.reflect.define-property');
require('./modules/es6.reflect.delete-property');
require('./modules/es6.reflect.enumerate');
require('./modules/es6.reflect.get');
require('./modules/es6.reflect.get-own-property-descriptor');
require('./modules/es6.reflect.get-prototype-of');
require('./modules/es6.reflect.has');
require('./modules/es6.reflect.is-extensible');
require('./modules/es6.reflect.own-keys');
require('./modules/es6.reflect.prevent-extensions');
require('./modules/es6.reflect.set');
require('./modules/es6.reflect.set-prototype-of');
require('./modules/es7.array.includes');
require('./modules/es7.string.at');
require('./modules/es7.string.pad-left');
require('./modules/es7.string.pad-right');
require('./modules/es7.string.trim-left');
require('./modules/es7.string.trim-right');
require('./modules/es7.regexp.escape');
require('./modules/es7.object.get-own-property-descriptors');
require('./modules/es7.object.values');
require('./modules/es7.object.entries');
require('./modules/es7.map.to-json');
require('./modules/es7.set.to-json');
require('./modules/js.array.statics');
require('./modules/web.timers');
require('./modules/web.immediate');
require('./modules/web.dom.iterable');
module.exports = require('./modules/$.core');
},{"./modules/$.core":18,"./modules/es5":87,"./modules/es6.array.copy-within":88,"./modules/es6.array.fill":89,"./modules/es6.array.find":91,"./modules/es6.array.find-index":90,"./modules/es6.array.from":92,"./modules/es6.array.iterator":93,"./modules/es6.array.of":94,"./modules/es6.array.species":95,"./modules/es6.function.has-instance":96,"./modules/es6.function.name":97,"./modules/es6.map":98,"./modules/es6.math.acosh":99,"./modules/es6.math.asinh":100,"./modules/es6.math.atanh":101,"./modules/es6.math.cbrt":102,"./modules/es6.math.clz32":103,"./modules/es6.math.cosh":104,"./modules/es6.math.expm1":105,"./modules/es6.math.fround":106,"./modules/es6.math.hypot":107,"./modules/es6.math.imul":108,"./modules/es6.math.log10":109,"./modules/es6.math.log1p":110,"./modules/es6.math.log2":111,"./modules/es6.math.sign":112,"./modules/es6.math.sinh":113,"./modules/es6.math.tanh":114,"./modules/es6.math.trunc":115,"./modules/es6.number.constructor":116,"./modules/es6.number.epsilon":117,"./modules/es6.number.is-finite":118,"./modules/es6.number.is-integer":119,"./modules/es6.number.is-nan":120,"./modules/es6.number.is-safe-integer":121,"./modules/es6.number.max-safe-integer":122,"./modules/es6.number.min-safe-integer":123,"./modules/es6.number.parse-float":124,"./modules/es6.number.parse-int":125,"./modules/es6.object.assign":126,"./modules/es6.object.freeze":127,"./modules/es6.object.get-own-property-descriptor":128,"./modules/es6.object.get-own-property-names":129,"./modules/es6.object.get-prototype-of":130,"./modules/es6.object.is":134,"./modules/es6.object.is-extensible":131,"./modules/es6.object.is-frozen":132,"./modules/es6.object.is-sealed":133,"./modules/es6.object.keys":135,"./modules/es6.object.prevent-extensions":136,"./modules/es6.object.seal":137,"./modules/es6.object.set-prototype-of":138,"./modules/es6.object.to-string":139,"./modules/es6.promise":140,"./modules/es6.reflect.apply":141,"./modules/es6.reflect.construct":142,"./modules/es6.reflect.define-property":143,"./modules/es6.reflect.delete-property":144,"./modules/es6.reflect.enumerate":145,"./modules/es6.reflect.get":148,"./modules/es6.reflect.get-own-property-descriptor":146,"./modules/es6.reflect.get-prototype-of":147,"./modules/es6.reflect.has":149,"./modules/es6.reflect.is-extensible":150,"./modules/es6.reflect.own-keys":151,"./modules/es6.reflect.prevent-extensions":152,"./modules/es6.reflect.set":154,"./modules/es6.reflect.set-prototype-of":153,"./modules/es6.regexp.constructor":155,"./modules/es6.regexp.flags":156,"./modules/es6.regexp.match":157,"./modules/es6.regexp.replace":158,"./modules/es6.regexp.search":159,"./modules/es6.regexp.split":160,"./modules/es6.set":161,"./modules/es6.string.code-point-at":162,"./modules/es6.string.ends-with":163,"./modules/es6.string.from-code-point":164,"./modules/es6.string.includes":165,"./modules/es6.string.iterator":166,"./modules/es6.string.raw":167,"./modules/es6.string.repeat":168,"./modules/es6.string.starts-with":169,"./modules/es6.string.trim":170,"./modules/es6.symbol":171,"./modules/es6.weak-map":172,"./modules/es6.weak-set":173,"./modules/es7.array.includes":174,"./modules/es7.map.to-json":175,"./modules/es7.object.entries":176,"./modules/es7.object.get-own-property-descriptors":177,"./modules/es7.object.values":178,"./modules/es7.regexp.escape":179,"./modules/es7.set.to-json":180,"./modules/es7.string.at":181,"./modules/es7.string.pad-left":182,"./modules/es7.string.pad-right":183,"./modules/es7.string.trim-left":184,"./modules/es7.string.trim-right":185,"./modules/js.array.statics":186,"./modules/web.dom.iterable":187,"./modules/web.immediate":188,"./modules/web.timers":189}],191:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            currentQueue[queueIndex].run();
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[1]);

define("babelPolyfill", function(){});

define('main',['exports', 'jquery', 'calculator/lib/Actions', 'calculator/lib/Calculations', 'calculator/config/actions', 'calculator/config/calculations', 'calculator/lib/Layout', 'calculator/lib/managers/CalculationManager', 'calculator/lib/managers/ActionManager', 'calculator/lib/managers/TokenManager', 'calculator/lib/managers/HistoryManager', 'calculator/lib/managers/MemoryManager', 'calculator/lib/managers/ChangeManager', 'calculator/config/standard', 'babelPolyfill'], function (exports, _jquery, _Actions, _Calculations, _actions, _calculations, _Layout, _CalculationManager, _ActionManager, _TokenManager, _HistoryManager, _MemoryManager, _ChangeManager, _standard) {
        'use strict';

        Object.defineProperty(exports, "__esModule", {
                value: true
        });

        var _jquery2 = _interopRequireDefault(_jquery);

        var _Actions2 = _interopRequireDefault(_Actions);

        var _Calculations2 = _interopRequireDefault(_Calculations);

        var _actions2 = _interopRequireDefault(_actions);

        var _calculations2 = _interopRequireDefault(_calculations);

        var _Layout2 = _interopRequireDefault(_Layout);

        var _CalculationManager2 = _interopRequireDefault(_CalculationManager);

        var _ActionManager2 = _interopRequireDefault(_ActionManager);

        var _TokenManager2 = _interopRequireDefault(_TokenManager);

        var _HistoryManager2 = _interopRequireDefault(_HistoryManager);

        var _MemoryManager2 = _interopRequireDefault(_MemoryManager);

        var _ChangeManager2 = _interopRequireDefault(_ChangeManager);

        var _standard2 = _interopRequireDefault(_standard);

        function _interopRequireDefault(obj) {
                return obj && obj.__esModule ? obj : {
                        default: obj
                };
        }

        function _classCallCheck(instance, Constructor) {
                if (!(instance instanceof Constructor)) {
                        throw new TypeError("Cannot call a class as a function");
                }
        }

        var _class = function _class(options) {
                _classCallCheck(this, _class);

                var mode = _standard2.default;
                this.$el = (0, _jquery2.default)('<div class="calculator">');

                this.tokenManager = new _TokenManager2.default();
                this.historyManager = new _HistoryManager2.default(this.tokenManager);
                this.memoryManager = new _MemoryManager2.default(this.tokenManager);
                this.layout = new _Layout2.default(this.tokenManager, this.historyManager, this.memoryManager, mode);

                this.actions = new _Actions2.default(_actions2.default);
                this.calculations = new _Calculations2.default(_calculations2.default);

                this.calculationManager = new _CalculationManager2.default(this.calculations, this.tokenManager);
                this.actionManager = new _ActionManager2.default(this.actions, this.layout);

                this.changeManager = new _ChangeManager2.default(this.tokenManager, this.memoryManager, mode);

                registerButtons.call(this);

                this.$el.append(this.layout.$el);
        };

        exports.default = _class;


        function registerButtons() {
                var _iteratorNormalCompletion = true;
                var _didIteratorError = false;
                var _iteratorError = undefined;

                try {
                        for (var _iterator = this.layout.buttons[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                                var button = _step.value;

                                this.calculationManager.registerButton(button);
                                this.actionManager.registerButton(button);
                        }
                } catch (err) {
                        _didIteratorError = true;
                        _iteratorError = err;
                } finally {
                        try {
                                if (!_iteratorNormalCompletion && _iterator.return) {
                                        _iterator.return();
                                }
                        } finally {
                                if (_didIteratorError) {
                                        throw _iteratorError;
                                }
                        }
                }
        }
});
//# sourceMappingURL=main.js.map
;
    return require('main').default;
}));