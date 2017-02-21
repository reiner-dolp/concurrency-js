/*globals
	shorten_string
*/
(function(ns, global, undefined) { "use strict";

ns.Task = Task;

/**
 * Create a new task that should be executed on another thread. 
 *
 * __Transferables and custom datatypes:__
 *
 * Custom datatypes cannot be passed to another thread by default.
 * You have to create a `packer` and `unpacker`. See their respective
 * documentation. Datatypes with packers can be directly mentioned
 * in the list of __transferables__.
 *
 * Using this class with datatypes without a packer and unpacker is
 * unsupported and results in undefined behaviour. __Datatypes that may
 * contain an arraybuffer of length 0 are not supported.__
 *
 * __Passing functions instead of function names:__
 *
 * Note that serialization may fail depending on the environment:
 * ES 3 and 5 specs say that Function.prototype.toString returns "[an]
 * implementation-dependent representation of the function" that "has the
 * syntax of a FunctionDeclaration" (§15.3.4.2).
 *
 * Note that you cannot serialize functions that implement native
 * code, e.g. `Task(Math.max)` will fail.
 *
 * Serialization errors may not be detected correctly resulting in undefined
 * behaviour.
 *
 * __Executing functions with async results:__
 *
 * By default, the synchronous result will be returned. To retrieve the result
 * of a callback do the following:
 *
 * ```js
 * // construct the task object as you would do normally
 * // However, set the parameter that expects the callback function to <ASYNC()>
 * var task = new Task(function(callback) { setTimeout(function() {callback(1), 0); return 2 }, [ASYNC()])
 * var sync_result = task.run_fn(function(result) {
 *      // echoes <Result is: 1>
 * 	console.log("ASYNC result is: " + result);
 * });
 * console.log("SYNC result is: " + sync_result);
 * ```
 * As a comparision a sync usage example:
 * ```js
 * var task = new Task(function(a) { return a + 1; }, [1])
 * var result = task.run_fn();
 * // result is <2> now
 * ```
 * Or alternatively using a callback function:
 * ```js
 * var task = new Task(function(a) { return a + 1; }, [1])
 * task.run_fn(function(result) {
 *      // echoes <2>
 * 	console.log(result);
 * });
 * ```
 *
 * __How methods are found using their methodname:__
 *
 * @param {string|function} a method name or a function to serialize.
 * functions MUST NOT have side effects, e.g. set a counter variable or make
 * I/O. You can use the String `{DATA}` to call a method on payload of the task.
 *
 * @param {array} [args] a list of arguments to pass to the function
 *
 * @param {transferable} [transferables] an object that should be transfered to
 * the worker thread. (Passed by reference instead of copying. The buffer cannot
 * be accessed in the original thread until the function returned.) By passing
 * `true` all transferables are automatically detected and transfered.
 */
function Task(task, args, transferables) {
	args = args || [];
	transferables = transferables || [];

	if(transferables === true) {
		transferables = get_all_transferables(args);
	}

	ASSERT_IS_CTOR(this, Task);
	ASSERT_IS_ARRAY(args);
	ASSERT_IS_ARRAY(transferables);

	if(typeof task === "function") {
		this.fn = try_seralize_func(task);
	} else {
		this.fn_name = task;
	}

	this.args = args;
	this.transferables = transferables;

	// allows additional values to be added. content is
	// persisted between threads, but ignored otherwise.
	this._data = {};

	this._this_arg = null;
	this._lookup_table = null;
	this._force_copylist = [];
}

Task.prototype.set_this_argument = function (this_arg) {
	this._this_arg = this_arg;
};

Task.prototype.set_lookup_table = function (lookup) {
	this._lookup_table = lookup;
};

/**
 * Excludes some transferables from the __next__ transfer.
 */
Task.prototype.remove_transferable = function (obj) {
	this._force_copylist = this._force_copylist.concat(WorkerPool._pack(obj, true));
};

Task.prototype.run_fn = function(callback) {
	var fn;
	var this_arg = this._this_arg;

	if(this.fn) {
		eval("fn=" + this.fn);
	} else {
		var callinfo = lookup_fn(this.fn_name, this._lookup_table, this._this_arg);
		this_arg = callinfo.this_arg;
		fn = callinfo.method;
	}

	ASSERT_IS_FUNC(fn);

	var args = this.args.slice();
	var async_arg_pos = resolve_late_bindings(args);
	var ret;

	if(async_arg_pos === null) {
		ret = fn.apply(this_arg, args);
		if(typeof callback === "function") { callback(ret, this); }
		return ret;
	} else {
		var async_callback = (function(self, callback) { return function(result) {
			if(typeof callback === "function") { callback(result, self); }
		};})(this, callback);

		args[async_arg_pos] = async_callback;
		ret = fn.apply(this_arg, args);
		return ret;
	}
};

Task.prototype.to_transferable = function() {

	// replace all args with their packed transferable result
	var _args = [];

	for(var i = 0; i < this.args.length; ++i) {
		_args[i] = WorkerPool._pack(this.args[i]);
	}

	// replaces custom types in the transferable list with
	// the actual values.
	var transferables = [];

	for(i = 0; i < this.transferables.length; ++i) {
		var curr_transferable = WorkerPool._pack(this.transferables[i], true);
		transferables = transferables.concat(curr_transferable);
	}

	// pack this argument
	var this_arg = this._this_arg;

	if(this_arg !== null) {
		transferables = transferables.concat(WorkerPool._pack(this_arg, true));
		this_arg = WorkerPool._pack(this_arg);
	}

	for(i = 0; i < this._force_copylist.length; ++i) {
		var index = transferables.indexOf(this._force_copylist[i]);
		if(index !== -1) {
			transferables.splice(index, 1);
		}
	}

	this._force_copylist = [];

	return {
		args: _args,
		fn: this.fn,
		fn_name: this.fn_name,
		transferables: transferables,
		_data: this._data,
		_this_arg: this_arg,
		_lookup_table: this._lookup_table
	};
};

Task.from_transferable = function(t) {

	var _args = [];

	for(var i = 0; i < t.args.length; ++i) {
		_args[i] = WorkerPool._unpack(t.args[i]);
	}

	var this_arg = WorkerPool._unpack(t._this_arg);

	var task = new Task(null, _args, t.transferables);
	task.fn = t.fn;
	task.fn_name = t.fn_name;
	task._data = t._data;
	task._this_arg = this_arg;
	task._lookup_table = t._lookup_table;

	return task;
};

/**
 * Tests whether the task can be transfered to another thread or not.
 *
 * @return false, if any of the buffers is currently passed
 * to a thread, making it impossible to transfer it to another task. true,
 * if all buffers are available for transfer
 */
Task.prototype.has_neutered_buffer = function() {

	var transferables = this.transferables.slice();
	transferables.push(this._this_arg);

	for(var i = 0; i < transferables.length; ++i) {
		var curr_transferables = WorkerPool._pack(transferables[i], true);
		for(var j = 0; j < curr_transferables.length; ++j) {
			if(curr_transferables[j].byteLength === 0) {
				return true;
			}
		}
	}

	return false;
};

function resolve_late_bindings(args) {
	var async_pos = null;

	for(var arg_i = 0, arg_l = args.length; arg_i < arg_l; ++arg_i) {
		if(args[arg_i] instanceof LateStaticBinding) {
			args[arg_i] = args[arg_i]._resolve();
		} else if(args[arg_i] instanceof AsyncResult) {
			async_pos = arg_i;
		}
	}

	return async_pos;
}

Task.IDENTIFIER_GLOBAL = "{GLOBAL}";
Task.IDENTIFIER_THIS   = "{THIS}";

Task.DEFAULT_LOOKUP_TABLE = [
	Task.IDENTIFIER_THIS,
	Task.IDENTIFIER_GLOBAL,
];



function lookup_fn(fn_name, lookup, this_arg) {
	lookup = lookup || Task.DEFAULT_LOOKUP_TABLE;

	ASSERT_IS_ARRAY(lookup);
	ASSERT_IS_STRING(fn_name);

	for(var i = 0; i < lookup.length; ++i) {
		var lookup_base;
		var curr_lookup_base_mod = lookup[i];
	       
		if(curr_lookup_base_mod.indexOf(Task.IDENTIFIER_THIS) === 0) {
			lookup_base = this_arg;
			if(lookup_base === null || lookup_base === undefined) {
				continue;
			}
			curr_lookup_base_mod = curr_lookup_base_mod.slice(Task.IDENTIFIER_THIS.length);
		} else {
			lookup_base = global;
			if(curr_lookup_base_mod.indexOf(Task.IDENTIFIER_GLOBAL) === 0) {
				curr_lookup_base_mod = curr_lookup_base_mod.slice(Task.IDENTIFIER_GLOBAL.length);
			}
		}

		var curr = curr_lookup_base_mod === "" ? lookup_base : lookup_base[curr_lookup_base_mod];

		if(is_func(curr[fn_name])) {
			return {method: curr[fn_name], this_arg: curr};
		}

		// try to unwrap if it is a function, that does not start with an uppercase letter
		if(is_func(curr) && !(curr.name.length > 0 && curr.name[0].toUpperCase() === curr.name[0])) {
			// TODO: ensure correct this argument. But how?
			curr = curr.call(lookup_base);
			if(is_func(curr[fn_name])) {
				return {method: curr[fn_name], this_arg: curr};
			}
		}
	}

	throw new Error("Trying to run task with undefined function <" + shorten_string(fn_name) + ">");
}

function get_all_transferables(args) {
	var transferables = [];
	// replaces custom types in the transferable list with
	// the actual values.
	for(var i = 0; i < args.length; ++i) {
		if(args[i] !== undefined && args[i] !== null && typeof args[i].constructor !== "undefined") {
			var typename = args[i].constructor.name;

			if(WorkerPool.packer[typename] && WorkerPool.unpacker[typename]) {
				transferables.push(args[i]);
			}
		}
	}

	return transferables;
}

function try_seralize_func(fn) {
	ASSERT_IS_FUNC(fn);

	var str = String(fn);

	//if(str.indexOf("[native code]") !== -1 && ns[fn.name]) { // may work
		//str = "function(){return (" + fn.name + ")();}";
	//}

	ASSERT(str.indexOf("[native code]") === -1, "serialization of native method is not possible!");
	ASSERT(eval("fn=" + str), "Serialization failed. Function cannot be deserialized.");

	return str;
}

})(this, this);
