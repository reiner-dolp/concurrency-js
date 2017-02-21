/*globals
	DefeeredResult,
	LateStaticBinding,
	AsyncResult
*/
(function(ns, undefined) { "use strict";

ns.WorkerPool.packer.DefeeredResult = function(defres, only_transferables) {

	if(only_transferables) {
		return [];
	}
		
	return {
		val_a: defres.val_a,
		val_b: defres.val_b
	};
};

ns.WorkerPool.unpacker.DefeeredResult = function(decomp) {
	return new DefeeredResult(decomp.val_a, decomp.val_b);
};

ns.WorkerPool.packer.LateStaticBinding = function(lsb, only_transferables) {

	if(only_transferables) {
		return [];
	}
		
	return {
		varname: lsb.varname
	};
};

ns.WorkerPool.unpacker.LateStaticBinding = function(decomp) {
	return new LateStaticBinding(decomp.varname);
};

ns.WorkerPool.packer.AsyncResult = function(async, only_transferables) {

	if(only_transferables) {
		return [];
	}
		
	return {};
};

ns.WorkerPool.unpacker.AsyncResult = function() {
	return new AsyncResult();
};

})(this);
