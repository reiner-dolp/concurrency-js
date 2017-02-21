/*globals
	Img,
	Histogram,
	Graph,
	Vertex,
	EventEmitter,
	DefeeredResult,
	Await,
	WorkerPool,
	Task,
	
	is_array,
	is_int,
	is_func,
	format_string,
	braillescanner,
*/
/* # Processing Pipeline
 *
 * __Vocabulary used__:
 *
 * <dl>
 * <dt>Task
 * <dd>A Task is an action that should be performed; a single method call. A
 * Task description consists of a method name, a list of arguments and a value
 * that will be bound as `this`.
 *
 * <dt>Pipeline Configuration
 * <dd>A list of tasks. Each pipeline instance has exactly one pipeline
 * configuration.
 *
 * <dt>Pipeline Context
 * <dd>A new pipeline context is established with each call to `#process()`. It
 * contains the state of the process call, e.g. which Tasks are done? which
 * are currently executing? ... A pipeline can have multiple contexts.
 * </dl>
 *
 * __Multithreading support__:
 *
 * Use the 'NO_MULTITHREADING' flag for tasks that should execute in the
 * GUI-Thread, e.g. Tasks that access the DOM, use the GPU or similar.
 * Method names that match any of the regular expressions in the array
 * `#_no_multithread_list` are automatically excluded from multithreading.
 *
 * Multithreading is disabled by default. Use `#enable_multithreading()` to
 * enable it.
 *
 * __Events emitted:__
 * task_dispatch: a task starts execution
 * - [string] task_name,
 * - [PipelineExecutionContext] context
 *
 * task_done: a task finished execution. Arguments passed are
 * - [string] finished_task,
 * - [Task] task_obj,
 * - [Any] result,
 * - [int] worker_index,
 * - [PipelineExecutionContext] context
 *
 * context_terminated: a context is terminated using
 * `PipelineExecutionContext#stop()` or `Pipeline#terminate()`. Same arguments
 * as task_done.
 */
;(function(global, undefined) { "use strict";

var instance_counter = 0;
global.Pipeline = Pipeline;

var MSG_ERROR_CYCLE = "The pipeline configuration has a cyclic dependency.";
var MSG_PIPELINE_STARVATION = "The pipeline configuration did not lead to the targeted state.";
var MSG_TASK_DESC_TYPE = "Pipeline task <{0}> was expected to be an object, got <{1}> instead.";
var MSG_TASK_DESC_FIELD_COMMAND = "Pipeline task <{0}> was expected to have a field 'command' of type String, Await or DefeeredResult. Got type <{1}> instead.";
var MSG_TASK_DESC_FIELD_ARGS = "The optional argument 'args' of pipeline task <{0}> must be of type Array";
var MSG_TASK_DESC_ONLY_AS_DEP = "Pipeline task <{0}> for <{1}> is mentioned as dependency, but does not have a task description.";

/**
 * Encapsulates all information of a single call to `Pipeline#process` allowing
 * a pipeline to execute multiple calls at once.
 */
function PipelineExecutionContext(info) {

	this._schedule = [];
	this._finished_tasks = [];
	this._result_of = {};

	ASSERT_IS_OBJ(info);
	ASSERT_IS_STRING(info.target);
	ASSERT(info.graph_ref instanceof Graph);
	ASSERT(info.graph_ref.has_vertex(info.target));
	ASSERT(info.callback === undefined || info.callback === null ||
			typeof info.callback === "function");

	this._schedule_graph = new Graph(info.graph_ref);

	this._callback = info.callback;
	this._target = info.target;
}

/**
 * Try to terminate pipeline execution of this context
 * as soon as possible.
 *
 */
PipelineExecutionContext.prototype.stop = function() {
	this._stop = true;
};

/**
 * Instantiate a new image processing pipeline.
 *
 * @param cfg the pipeline configuration
 *
 * ```js
 * {
 * 	"human readable task description": {
 * 		command: "method_name", args: ["arg1", 2, RESULT_OF("and another")]
 * 	},
 * 	"and another": { ... }
 * }
 * ```
 *
 * The pipeline command names are property names of one of the
 * following objects. Resolved in the order presented:
 *
 * 1. Img#manipulate#{command}
 * 2. Img#{command}
 * 3. {global context}#{command}
 *
 * Separation using dots to access nested objects is possible.
 * Dependencies within the pipeline are automatically resolved using
 * the deferred result variables in the commands argument list.
 *
 * @param [Array] lookup will overwrite the default lookup
 * table for command names.
 */
function Pipeline(pipeline_cfg, lookup_table) {
	this._id = instance_counter++;
	this._lookup = lookup_table;
	this._no_multithread_list = [/^lightbox/, /_gpu$/];
	this._active_contexts = [];

	if(lookup_table !== undefined) {
		ASSERT_IS_ARRAY(lookup_table);
	}
	
	ASSERT_IS_OBJ(pipeline_cfg);

	this.cfg = pipeline_cfg;

	this.eventEmitter = new EventEmitter();

	this._callback_executing_next_command = (function(pipeline) { return function(result, task_obj, worker_index) {
		if(task_obj._data._is_pipeline_task === pipeline._id) {
		pipeline._try_to_execute_next_task(task_obj._data.context_index, task_obj._data.task_name, task_obj, result, worker_index);
		}
	};})(this);
}

Pipeline.prototype.graph = function() {
	ASSERT(!this._stop_all, "Pipeline terminated");

	if(!this.cfg_graph) {
		this.cfg_graph = _build_dependency_graph(this.cfg);

		if(this.cfg_graph.has_cycle()) {
			throw new Error(MSG_ERROR_CYCLE);
		}
	}

	return new Graph(this.cfg_graph);
};

function _build_dependency_graph(pipeline_cfg) {
	var graph = new Graph();

	// iterate over all tasks
	for(var propname in pipeline_cfg) {
		if(pipeline_cfg.hasOwnProperty(propname)) {

			if(typeof pipeline_cfg[propname] !== "object") {
				throw new Error(format_string(
					MSG_TASK_DESC_TYPE,
					propname,
					typeof pipeline_cfg[propname])
				);
			}

			var task = pipeline_cfg[propname];

			if(typeof task.command !== "string" &&
				!(task.command instanceof DefeeredResult) &&
				!(task.command instanceof Await)) {
				throw new Error(format_string(
					MSG_TASK_DESC_FIELD_COMMAND,
					propname,
					typeof task.command)
				);
			}

			if(typeof task.args === "undefined") {
				task.args = [];
			}

			if(!is_array(task.args)) {
				throw new Error(format_string(
					MSG_TASK_DESC_FIELD_ARGS,
					propname)
				);
			}

			if(!graph.has_vertex(propname)) {
				graph.add_vertex(propname, 0);
			}

			if(task.PRESERVE_RESULT_COPY) {
				++graph.get_vertex_by_name(propname).weight;
			}

			var depname;

			// add explicit dependency
			if(task.command instanceof DefeeredResult ||
			   task.command instanceof Await) {
				depname = task.command.dependency;

				if(!graph.has_vertex(depname)) {
					graph.add_vertex(depname, 0);
				}

				// weight is the number of defeered result dependencies
				if(task.command instanceof DefeeredResult && !task.command._pass_ref) {
					++graph.get_vertex_by_name(depname).weight;
				}

				graph.add_edge(propname, depname);
			}

			// iterate over all args 
			for(var j = 0; j < task.args.length;  ++j) {
				// check for dependency
				// Note: AWAIT does not make sense in the argument list!
				if(task.args[j] instanceof DefeeredResult) {
					// add explicit dependency
					depname = task.args[j].dependency;

					if(!graph.has_vertex(depname)) {

						if(!pipeline_cfg.hasOwnProperty(depname)) {
							throw new Error(format_string(
								MSG_TASK_DESC_ONLY_AS_DEP,
								depname,
								propname)
							);
						}

						graph.add_vertex(depname, 0);
					}

					// weight is the number of defeered result dependencies
					if(!task.args[j]._pass_ref) {
						++graph.get_vertex_by_name(depname).weight;
					}

					graph.add_edge(propname, depname);
				}
			}

		}
	}

	return graph;
}

/**
 * Execute the pipeline until `target` is reached.
 * 
 * e.g. get the abstract syntax tree in our scanner example
 * configuration:
 *
 * ```
 * new Pipeline(cfg).process("Document AST");
 * ```
 *
 * @return a handle that can be used to query information about the execution
 */
Pipeline.prototype.process = function process(target, callback) {
	ASSERT(!this._stop_all, "Pipeline terminated");

	var context = new PipelineExecutionContext({
		graph_ref: this.graph(),
	    	target: target,
		callback: callback,
	});

	context._index = this._active_contexts.length;
	this._active_contexts[context._index] = context;

	this._try_to_execute_next_task(context);

	return context;
};

function print_debug_output(finished_task, result) {
	if(Pipeline.DUMP_RESULTS || // dump every step flag
	  typeof braillescanner !== "undefined" && // or dump this step flag
	  braillescanner.config && 
	  braillescanner.config.processing_pipeline &&
	  braillescanner.config.processing_pipeline[finished_task] &&
	  braillescanner.config.processing_pipeline[finished_task].DUMP_RESULT) {
		if(braillescanner.trigger_img_browser_download && result instanceof Img) {
			braillescanner.trigger_img_browser_download(result, "image/png", finished_task + ".png");
		} else {
			if(is_array(result)) {
				console.info("Result of task <" + finished_task + ">");
				console.table(result);
			} else {
				console.info("Result of task <" + finished_task + ">", result);
			}
		}
	}

	if(typeof braillescanner !== "undefined" && // dump histogram flag
	  braillescanner.config && 
	  braillescanner.config.processing_pipeline &&
	  braillescanner.config.processing_pipeline[finished_task] &&
	  typeof braillescanner.config.processing_pipeline[finished_task].DUMP_RESULT_HISTOGRAM !== "undefined" &&
	  braillescanner.trigger_img_browser_download && result instanceof Img &&
	  typeof Histogram !== "undefined" && typeof Histogram.render === "function") {
		var rel = braillescanner.config.processing_pipeline[finished_task];
		var hist_channels = rel.DUMP_RESULT_HISTOGRAM;
		ASSERT_IS_ARRAY(hist_channels, "DUMP_RESULT_HISTOGRAM must be an array containing channel indices");
		var histograms = [];
		var opts = rel.HISTOGRAM_OPTIONS || {};
		for(var i = 0; i < hist_channels.length; ++i) {
			histograms.push(new Histogram(result, hist_channels[i], opts));	
		}
		
		opts.channels = hist_channels;
		var hist_img = Histogram.render(histograms, opts);
		braillescanner.trigger_img_browser_download(hist_img, "image/png", finished_task + " (Histogram).png");
	}
}

/**
 * INTERNAL USE ONLY; do not call!
 * Updates the ready queue; then schedules and dispatches the next task.
 *
 * (call this method to keep the pipeline running. Stop the pipeline
 * by not calling this method after a task finishes.)
 */
Pipeline.prototype._try_to_execute_next_task = function(context, finished_task, task_obj, result, worker_index) {

	if(is_int(context)) {
		ASSERT(context < this._active_contexts.length);
		context = this._active_contexts[context];
	}

	if(context._stop || this._stop_all) {
		this.eventEmitter.emit("context_terminated", finished_task, task_obj, result, worker_index, context);
		this._active_contexts[context._index] = null;
		return;
	}

	ASSERT(context instanceof PipelineExecutionContext);
	ASSERT(typeof finished_task === "undefined" || context._schedule.indexOf(finished_task) !== -1);

	if(worker_index !== null && worker_index !== undefined) {
		ASSERT_IS_INT(worker_index);
	} 

	if(typeof finished_task !== "undefined") {
		var index = context._schedule.indexOf(finished_task);
		context._schedule.splice(index, 1);
		context._finished_tasks.push(finished_task);
		context._schedule_graph.remove_vertex(finished_task);
		context._result_of[finished_task] = result;

		print_debug_output(finished_task, result);

		this._garbage_collect_results(context);
		this.eventEmitter.emit("task_done", finished_task, task_obj, result, worker_index, context);
	}

	if(finished_task === context._target) {
		if(is_func(context._callback)) {
			context._callback(result, context);
		}

		// TODO: _active_contexts could theoretically overflow
		this._active_contexts[context._index] = null;

		return;
	}

	this._update_ready_queue(context);
	this._dispatch(context, this._schedule_task(context));
};

Pipeline.prototype._garbage_collect_results = function() {
};

/**
 * Admission scheduler: Puts all tasks that can be executed in a ready queue
 * without a specific order.
 *
 * MUST be called each time a task finishes.
 */
Pipeline.prototype._update_ready_queue = function _update_ready_queue(context) {
	var leafs = context._schedule_graph.get_leaf_vertices();

	if(leafs.length === 0 && context._schedule.length === 0) {
		throw new Error(MSG_PIPELINE_STARVATION);
	}

	for(var i = 0, l = leafs.length; i < l; ++i) {
		ASSERT(leafs[i] instanceof Vertex);
		// avoid duplicates:
		if(context._schedule.indexOf(leafs[i].id) === -1) {
			context._schedule.push(leafs[i].id);
		}
	}
};

/**
 * (short-time) scheduler: Selects the next task to execute from
 * the ready queue.
 *
 * @return {int} task index
 */
Pipeline.prototype._schedule_task = function _schedule(context) {
	ASSERT(context._schedule.length > 0, "Requested to schedule task, but no task admitted by long-term scheduler");
	ASSERT(this.cfg.hasOwnProperty(context._schedule[0]), "next task scheduled <" + context._schedule[0] + "> does not have a task description in the configuration file");

	return context._schedule[0];
};

/**
 * Dispatcher: executes the given task (In most cases previously
 * selected by the scheduler.)
 *
 * @param {int} task index
 */
Pipeline.prototype._dispatch = function _dispatch(context, task_name) {
	ASSERT_IS_OBJ(this.cfg[task_name], "Trying to dispatch unknown task <" + task_name + ">");

	this.eventEmitter.emit("task_dispatch", task_name, context);

	var task = this._get_task_object(context, task_name);

	if(!this._workerpool || !this._should_multithread_task(task_name)) {
		task.run_fn(this._callback_executing_next_command);
	} else {
		// default lookup table in worker is already correct.
		// optimization:
		task.set_lookup_table(null);

		var parents = this._get_parents(task_name);

		for(var i = 0, l = parents.length; i < l; ++i) {

			if(this._has_multiple_decendents(parents[i]) &&
				!this._has_force_reference_flag(task_name)) {
				task.remove_transferable(this._get_result_of(context, parents[i]));
			}
		}
		
		this._workerpool.run_task(task);
		return;
	}
};

Pipeline.prototype._should_multithread_task = function(task_name) {

	// disable multithreading for DOM tasks, GPU tasks or similar...
	var disable_multithreading = this.cfg[task_name].NO_MULTITHREADING || false;
	var methodname = this._get_method_name(task_name);

	for(var i = 0; i < this._no_multithread_list.length; ++i) {
		if(this._no_multithread_list[i].test(methodname)) {
			disable_multithreading = true;
			//console.info("dynamically disabled multithreading for method <", methodname, "> in task <", task_name, ">");
			break;
		}
	}

	return !disable_multithreading;
};

Pipeline.prototype.enable_multithreading = function(include_list, num_threads) {
	ASSERT(!this._stop_all, "Pipeline terminated");

	this._workerpool = new WorkerPool(include_list, num_threads, this._lookup);
	this._workerpool.events.addListener("worker_done", this._callback_executing_next_command);
};

Pipeline.prototype.destroy_threads = function() {
	if(this._workerpool) {
		this._workerpool.terminate();
		this._workerpool = null;
	}
};

/**
 * Stop execution of all contexts as soon as possible and
 * destroy all worker threads. The Pipeline becomes unusable
 * after this method.
 *
 */
Pipeline.prototype.terminate = function() {
	this._stop_all = true;
	this.destroy_threads();
	// free memory
	this.graph = null;
	this._schedule = null;
	this._finished_tasks = null;
	this._result_of = null;
	this._schedule_graph = null;
	this._callback = null;
	this._target = null;
};

Pipeline.prototype._get_task_object = function(context, task_name) {
	ASSERT(context instanceof PipelineExecutionContext);

	var this_arg = this._get_this_arg(context, task_name);
	var args = this._get_args_of(context, task_name);

	var methodname = this._get_method_name(task_name);

	ASSERT_IS_ARRAY(args);

	var task = new Task(methodname, args, true);
	task._data.task_name = task_name;
	task._data.context_index = context._index;
	task._data._is_pipeline_task = this._id;
	task.set_this_argument(this_arg);
	task.set_lookup_table(this._lookup);

	return task;
};

Pipeline.prototype._has_force_reference_flag = function _has_force_reference_flag(task_name) {
	var methodname =  this.cfg[task_name].command;

	return methodname instanceof DefeeredResult && methodname._pass_ref;
};

Pipeline.prototype._get_method_name = function _get_method_name(task_name) {
	var methodname =  this.cfg[task_name].command;

	ASSERT(typeof methodname === "string" || methodname instanceof DefeeredResult ||
			methodname instanceof Await);

	if(methodname instanceof DefeeredResult ||
	   methodname instanceof Await) {
		methodname = methodname.then;
	}

	return methodname;
};

Pipeline.prototype._get_this_arg = function _get_this_arg(context, task_name) {
	ASSERT(context instanceof PipelineExecutionContext);

	var methodname = this.cfg[task_name].command;

	// Note: AWAIT() does not modify the this arg!
	if(methodname instanceof DefeeredResult) {
		var resultof = methodname.dependency;
		var this_arg = this._get_result_of(context, resultof);

		
		return this_arg;
	}

	return null;
};

Pipeline.prototype._get_args_of = function(context, task_name) {
	ASSERT(context instanceof PipelineExecutionContext);

	ASSERT_IS_STRING(task_name);
	ASSERT(this.cfg[task_name]);

	// ONLY SHALLOW COPY. TASKS MUST OBEY AN NOT MODIFY PIPELINE
	var args = this.cfg[task_name].args.slice();

	for(var i = 0; i < args.length; ++i) {
		if(args[i] instanceof DefeeredResult) {
			var resultof = args[i].dependency;
			args[i] = this._get_result_of(context, resultof);
		}
	}

	return args;
};

// TODO: possible race condition.
// TODO: Could also infer the moment the memory can be freed.
Pipeline.prototype._get_result_of = function(context, task_name) {
	ASSERT(context instanceof PipelineExecutionContext);
	ASSERT(context._result_of.hasOwnProperty(task_name), "Reference to undefined task result of not yet executed task <" + task_name + ">.");

	return context._result_of[task_name];
};

Pipeline.prototype._has_multiple_decendents = function(task_name) {
	return this.graph().get_vertex_by_name(task_name).weight > 1;
};

Pipeline.prototype._get_parents = function(task_name) {
	return this.graph().get_vertex_by_name(task_name).neighbours_out;
};

})(this);
