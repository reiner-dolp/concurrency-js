;(function(global) { "use strict";

global.LateStaticBinding = LateStaticBinding;
global.DefeeredResult = DefeeredResult;
global.AsyncResult = AsyncResult;
global.Await = Await;

global.RESULT_OF = RESULT_OF;
global.REFERENCE_TO_RESULT_OF = REFERENCE_TO_RESULT_OF;
global.AWAIT = AWAIT;
global.ASYNC_RESULT = ASYNC_RESULT;
global.ASYNC = ASYNC_RESULT;
global.VARIABLE = VARIABLE;

function RESULT_OF(a,b) {
	return new DefeeredResult(a,b);
}

function REFERENCE_TO_RESULT_OF(a,b) {
	return new DefeeredResult(a,b, true);
}

function AWAIT(a,b) {
	return new Await(a,b);
}

function ASYNC_RESULT() {
	return new AsyncResult();
}

function VARIABLE(varname) {
	return new LateStaticBinding(varname);
}

/**
 * Create a future like object.
 *
 * Create an unambigious argument value, that should be replaced
 * by the result of `dependency`.
 *
 * The return value of this method is called _deferred result variable_.
 *
 * MUST be called as constructor. Arguments are not validated by design.
 *
 * @param {Object} [dependency] object identifying  a task that should have
 * finished before `task` is executed
 *
 * @param {Object} [then] object identifying something that should be executed
 * as soon as the result of `dependency` is available.
 *
 * @param {boolean} [pass_ref] wether to pass a copy or not. `false` to pass
 * a copy. `true` to pass a reference.
 */
function DefeeredResult(dependency, then, pass_ref) {
	//ASSERT_IS_CTOR(this, DefeeredResult);
	this.dependency = dependency;
	this.then = then;
	this._pass_ref = pass_ref || false;
}

/**
 * Marks a parameter that takes a callback in a async method call.
 */
function AsyncResult() {
	//ASSERT_IS_CTOR(this, AsyncResult);
}

/**
 * Identical to `DefeeredResult`. However, the result of `dependency` is
 * not needed; only the temporal constraint/execution order should be
 * enforced.
 *
 * Therefore Await should not modify the this-arg and should not appear in an
 * argument list.
 *
 * @param {Object} [dependency] object identifying  a task that should have
 * finished before `task` is executed
 *
 * @param {Object} [then] object identifying something that should be executed
 * as soon as the result of `dependency` is available.
 */
function Await(dependency, then) {
	// assert package not imported in server environments
	//ASSERT_IS_CTOR(this, DefeeredResult);
	this.dependency = dependency;
	this.then = then;
}

function LateStaticBinding(varname) {
	//ASSERT_IS_CTOR(this, LateStaticBinding);
	this.varname = varname;
}

LateStaticBinding.prototype._resolve = function _resolve() {
	return global[this.varname];
};


})(typeof global !== "undefined" ? global : this);
