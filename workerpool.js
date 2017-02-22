/*globals
	EventEmitter
*/
/* #Multithreading using a Worker Pool
 *
 * __Minimal Usage Example:__ Increments 1 and prints it to the console.
 *
 * ```js
 * var pool = new WorkerPool();
 * pool.events.on("worker_done", function(i) { console.log(i); });
 * pool.run_task(new Task(function increment(i) { return i+1; }, 1));
 * ```
 *
 * __Dealing with tasks that share arguments: Detection of stalling__
 *
 * As transfered buffers cannot be shared among multiple workers, some
 * tasks may wait even though workers are free. The workerpool will
 * detect this instance and push the tasks with neutered arguments back.
 * An exception is thrown as soon as there are (i) no tasks currently executing and
 * (ii) available tasks are blocked.
 *
 * Note that neutered buffers are not automatically repopulated when
 * the buffer returns from another thread. The workerpool __does not__
 * attempt to repair neutered buffers.
 */
(function(ns, undefined) { "use strict";

ns.WorkerPool = WorkerPool;

ns.WorkerPool.WORKER_SCRIPT = "node_modules/concurrency-js/workerpool-worker.js";
ns.WorkerPool.WORKER_SCRIPT_ROOT = "../../";
ns.WorkerPool.MARK_UNPACKER = "_cast_to_original_datatype";

var MSG_WORKERPOOL_STALLED = 'Workerpool stalled. Cannot dispatch waiting tasks because they have neutered arguments.';

// neutered objects are transfered back. However, the buffer is not
// rereferenced in its original location
//var NEUTER_ID_PROPERTY_NAME = '_WORKERPOOL_PRE_NEUTERING_BUFFER_ID';
//var curr_neutering_id = 0;

//ns.WorkerPool.neutered_buffers = {};

ns.WorkerPool.unpacker = {};
ns.WorkerPool.packer   = {};
//ns.WorkerPool.reference_repair = {};

WorkerPool._pack = function(val, only_transferables) {

	if(val && typeof val.constructor !== "undefined") {

		var typename = val.constructor.name;

		if(WorkerPool.packer[typename]) {
			var valp = WorkerPool.packer[typename](val, only_transferables);

			if(!only_transferables) {
				valp[WorkerPool.MARK_UNPACKER] = typename;
			}

			return valp;
		}
	}

	if(only_transferables) {
		return [];
	} else {
		return val;
	}
};

WorkerPool._unpack = function(val) {
		if(val && typeof val[WorkerPool.MARK_UNPACKER] !== "undefined") {
			var typename = val[WorkerPool.MARK_UNPACKER];
			delete val[WorkerPool.MARK_UNPACKER];
			return WorkerPool.unpacker[typename](val);
		} else {
			return val;
		}
};

ns.WorkerPool.packer.ArrayBuffer = function(arrbuff, only_transferables) {
	if(only_transferables) {
		return [arrbuff];
	}
		
	return {
		buffer: arrbuff,
		buffertype: "ArrayBuffer"
	};
};

ns.WorkerPool.unpacker.ArrayBuffer = function(decomp) {
	return [decomp.buffer];
};

ns.WorkerPool.packer.Int8Array =
ns.WorkerPool.packer.Uint8Array =
ns.WorkerPool.packer.Int8Array =
ns.WorkerPool.packer.Uint8Array =
ns.WorkerPool.packer.Uint8ClampedArray =
ns.WorkerPool.packer.Int16Array =
ns.WorkerPool.packer.Uint16Array =
ns.WorkerPool.packer.Int32Array =
ns.WorkerPool.packer.Uint32Array =
ns.WorkerPool.packer.Float32Array =
ns.WorkerPool.packer.Float64Array = function(typedarray, only_transferables) {
	if(only_transferables) {
		return [typedarray.buffer];
	}
		
	return {
		buffer: typedarray.buffer,
		buffertype: typedarray.constructor.name
	};
};

ns.WorkerPool.unpacker.Int8Array =
ns.WorkerPool.unpacker.Uint8Array =
ns.WorkerPool.unpacker.Int8Array =
ns.WorkerPool.unpacker.Uint8Array =
ns.WorkerPool.unpacker.Uint8ClampedArray =
ns.WorkerPool.unpacker.Int16Array =
ns.WorkerPool.unpacker.Uint16Array =
ns.WorkerPool.unpacker.Int32Array =
ns.WorkerPool.unpacker.Uint32Array =
ns.WorkerPool.unpacker.Float32Array =
ns.WorkerPool.unpacker.Float64Array = function(decomp) {
	return new ns[decomp.buffertype](decomp.buffer);
};

//ns.WorkerPool.reference_repair.Int8Array =
//ns.WorkerPool.reference_repair.Uint8Array =
//ns.WorkerPool.reference_repair.Int8Array =
//ns.WorkerPool.reference_repair.Uint8Array =
//ns.WorkerPool.reference_repair.Uint8ClampedArray =
//ns.WorkerPool.reference_repair.Int16Array =
//ns.WorkerPool.reference_repair.Uint16Array =
//ns.WorkerPool.reference_repair.Int32Array =
//ns.WorkerPool.reference_repair.Uint32Array =
//ns.WorkerPool.reference_repair.Float32Array =
//ns.WorkerPool.reference_repair.Float64Array = function(neutered_data, buffer_data, transfer_id) {
//};

/**
 * Create a new worker pool.
 * 
 * @param {int} worker_count number of worker threads to use. Defaults to the
 * number of cpus available.
 *
 * @param {array of strings} [worker_scripts] an optional list of files that
 * should be loaded inside each worker.
 *
 */
function WorkerPool(worker_scripts, worker_count, lookup_table) {
	ASSERT_IS_CTOR(this, WorkerPool);

	worker_count = worker_count || this.number_of_cpus();

	worker_scripts = worker_scripts || [];

	ASSERT_IS_ARRAY(worker_scripts);
	ASSERT_IS_INT(worker_count);
	ASSERT(worker_count > 0);

	this.workers = [];
	this.worker_busy = [];
	this.wait_queue = [];
	this.events = new EventEmitter();

	for(var i = 0; i < worker_count; ++i) {
		this.workers[i] = new Worker(WorkerPool.WORKER_SCRIPT);
		this.workers[i].onerror = this._worker_on_error();
		this.workers[i].onmessage = this._worker_on_message();
		this.worker_busy[i] = false;
		this.workers[i].postMessage({
			worker_index: i,
			mark_unpacker: WorkerPool.MARK_UNPACKER,
			worker_script_root: WorkerPool.WORKER_SCRIPT_ROOT,
			load_scripts: worker_scripts,
			lookup_table: lookup_table
		});
	}
}

WorkerPool.prototype.run_task = function run_task(task) {
	var i = this.worker_busy.indexOf(false);

	//this._try_repair_neutered_references(task);

	if(i === -1 || task.has_neutered_buffer()) {
		//console.info("pushing", task.fn_name);
		this.wait_queue.push(task);
		return;
	} else {
		var packed = task.to_transferable();
		this.worker_busy[i] = task;
		//console.info("running", task.fn_name);
		this.workers[i].postMessage(packed, packed.transferables);
	}
};

WorkerPool.prototype._worker_on_error = function() {
	//return (function(self) {
		return function worker_on_error(e) {
			//self.events.emit("error", e);
			// convert ErrorEvent to Error
			var msg = e.message + " [" + e.filename + "@" + e.lineno + ":" + e.colno + "]";
			throw new Error(msg);
		};
	//})(this);
};

WorkerPool.prototype._worker_on_message = function() {
	return (function(self) {
		return function worker_on_message(e) {
			var unpacked_result = WorkerPool._unpack(e.data.result);
			// emit the result and original task object
			self.events.emit("worker_done", unpacked_result, self.worker_busy[e.data.worker_index], e.data.worker_index);
			//console.info("done with", self.worker_busy[e.data.worker_index].fn_name);
			// TODO: implement automatic back transfer
			self.worker_busy[e.data.worker_index] = false;

			if(self.wait_queue.length !== 0) {
				var i = self.worker_busy.indexOf(false);

				var task = null;

				for(var n = 0; n < self.wait_queue.length; ++n) {
					if(!self.wait_queue[n].has_neutered_buffer()) {
						task = self.wait_queue[n];
						break;
					}
				}
				
				if(task === null) {

					if(!self._has_running_tasks()) {
						throw new Error(MSG_WORKERPOOL_STALLED);
					}

					return;
				}

				self.worker_busy[i] = task;
				//console.info("running", task.fn_name);
				self.workers[i].postMessage(task.to_transferable(), task.transferables);
			}
		};
	})(this);
};

WorkerPool.prototype._has_running_tasks = function() {

	for(var n = 0; n < this.worker_busy.length; ++n) {
		if(this.worker_busy[n] !== false) {
			return true;
		}
	}

	return false;
};

WorkerPool.prototype.number_of_cpus = function() {

	if(navigator.hardwareConcurrency) {
		return navigator.hardwareConcurrency;
	} // todo estimate cores with polyfill

	return 1;
};

WorkerPool.prototype.code_string_to_url = function code_string_to_url(code) {
	return window.URL.createObjectURL(new Blob(code, {type: "text/javascript"}));
};

/**
 * Terminate all workers and free up memory associated with this thread pool.
 * Triggers the `pool_terminated` event.
 */
WorkerPool.prototype.terminate = function terminate() {
	for(var i = 0, worker_count = this.workers.length; i < worker_count; ++i) {
		this.workers[i].terminate();
		this.workers[i] = null;
	}

	this.events.emit("pool_terminated");
};

WorkerPool.prototype.is_terminated = function terminate() {
	return this.workers[0] === null;
};

//Task.prototype._write_neutering_repair_info = function(task) {
	//var vals = task.transferables.slice();
	//vals.push(task._this_arg);

	//for(var i = 0; i < vals.length; ++i) {
		//var transferables = WorkerPool._pack(vals[i], true);
		//for(var j = 0; j < transferables.length; ++j) {
			//// TODO: detect ID overflow
			//if(typeof transferables[j][NEUTER_ID_PROPERTY_NAME] !== "undefined") {
				//transferables[j][NEUTER_ID_PROPERTY_NAME] = curr_neutering_id;
				//neutering_ids[curr_neutering_id] = transferables[j];
				//++curr_neutering_id;
			//}
		//}
	//}
//};

//WorkerPool.prototype._try_repair_neutered_references = function(task) {
	//var vals = task.transferables.slice();
	//vals.push(task._this_arg);
	//vals.push(task.args);

	//for(var i = 0; i < vals.length; ++i) {
		//var transferables = WorkerPool._pack(vals[i], true);
		//var val_classname = typeof vals[i].constructor !== undefined ? vals[i].constructor.name : null;
		//for(var j = 0; j < transferables.length; ++j) {
			//if(transferables[j].byteLength === 0 &&
					//typeof transferables[j][NEUTER_ID_PROPERTY_NAME] !== "undefined" &&
					//val_classname !== null && WorkerPool._reference_repair[val_classname]) {
				   //WorkerPool._reference_repair[val_classname](i,
						   //neutering_ids[transferables[j][NEUTER_ID_PROPERTY_NAME]]);
			//}
		//}
	//}
//};

})(this);
