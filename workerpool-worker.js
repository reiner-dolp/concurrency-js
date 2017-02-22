/*globals
	WorkerPool,
	Task
*/
importScripts("node_modules/assert-js/assert.js");
importScripts("defeeredresultvariable.js");
importScripts("task.js");
importScripts("workerpool.js");
importScripts("packer/defeeredresultvariable.js");

var SCRIPT_ROOT = null;

(function(ns) { "use strict";

ASSERT(WorkerPool, "worker pool datatype cannot be found");
ASSERT_IS_OBJ(WorkerPool.unpacker, "worker pool datatype must have a list of unpackers");
ASSERT_IS_OBJ(WorkerPool.packer, "worker pool datatype must have a list of packers");

var LOADED_SCRIPTS = null;
var MARK_UNPACKER = null;
var INDEX = -1;

self.addEventListener('message', function(e) {

	// the first message should carry special information including our
	// identity within the workerpool and a list of additional scripts to
	// load
	if(LOADED_SCRIPTS === null) {
		ASSERT_IS_OBJ(e.data);
		ASSERT_IS_ARRAY(e.data.load_scripts);
		ASSERT_IS_STRING(e.data.mark_unpacker);
		ASSERT_IS_NON_NEGATIVE_INT(e.data.worker_index);

		MARK_UNPACKER = e.data.mark_unpacker;
		LOADED_SCRIPTS = e.data.load_scripts;
		SCRIPT_ROOT = e.data.worker_script_root;
		INDEX = e.data.worker_index;

		if(e.data.lookup_table !== undefined && e.data.lookup_table !== null) {
			Task.DEFAULT_LOOKUP_TABLE = e.data.lookup_table;
		}

		for(var i = 0; i < LOADED_SCRIPTS.length; ++i) {
			importScripts(SCRIPT_ROOT + "/" + LOADED_SCRIPTS[i]);
		}

	// All other calls should be tasks to run
	} else {
		ASSERT(LOADED_SCRIPTS !== null, "recieved message with task before initialization message");

		var task = Task.from_transferable(e.data);

		task.run_fn((function(task) {
			return function(result) {
				post_result(task, result);
			};
		})(task));
	}
}); 

function post_result(task, result) {
	var result_packed = WorkerPool._pack(result);
	var result_transfer = WorkerPool._pack(result, true);
	var task_transfer = task.to_transferable();

	var _all_transferables = task_transfer.transferables.concat(result_transfer);

	// remove duplicates, which cause errors in v8 engine
	_all_transferables = _all_transferables.filter(function(item, pos) {
	    return _all_transferables.indexOf(item) === pos;
	});

	postMessage({
		result: result_packed,
		worker_index: INDEX,
		automatic_backtransfer: task_transfer
	}, _all_transferables);
}

})(this);
