(function(global, undefined) { "use strict";

global.Graph = Graph;
global.Vertex = Vertex;
global.DepthFirstGraphIterator = DepthFirstGraphIterator;

/**
 * Data object for the vertex of a graph.
 *
 *
 * @param {string|Vertex} id MUST be unique in the graph! Passing a vertex
 * instead, triggers the copy constructor. In this case, all other arguments
 * MUST be undefined.
 *
 * @param {any} weight the value of the node
 * @param {string[]} neighbours_out a list of edges leaving this vertex
 * @param {string[]} neighbours_in  a list of edges entering this vertex
 */
function Vertex(id, weight, neighbours_out, neighbours_in) {
	ASSERT_IS_CTOR(this, Vertex);

	// copy constructor
	if(id instanceof Vertex) {
		ASSERT(typeof weight === "undefined" &&
		       typeof neighbours_out == "undefined" &&
		       typeof neighbours_in == "undefined"
		);


		this.id = id.id;
		this.weight = id.weight;
		this.neighbours_out = id.neighbours_out.slice();
		this.neighbours_in = id.neighbours_in.slice();

		return;
	}

	// normal constructor
	weight = weight;
	neighbours_out = neighbours_out || [];
	neighbours_in  = neighbours_in || [];

	ASSERT_IS_ARRAY(neighbours_out);
	ASSERT_IS_ARRAY(neighbours_in);

	this.id = id;
	this.weight = weight;
	this.neighbours_out = neighbours_out;
	this.neighbours_in = neighbours_in;
}

/**
 * Create a new graph
 *
 * @param {Graph} [graph] a graph that should be copied
 */
function Graph(copy) {
	ASSERT_IS_CTOR(this, Graph);
	ASSERT(typeof copy === "undefined" || copy instanceof Graph);

	this.vertices = [];

	if(copy instanceof Graph) {
		for(var i = 0, l = copy.vertices.length; i < l; ++i) {
			this.vertices.push(new Vertex(copy.vertices[i]));
		}
	}
}

Graph.prototype.add_vertex = function add_vertex(vertex, weight) {
	ASSERT(typeof vertex === "string" || vertex instanceof Vertex);
	ASSERT(!this.has_vertex(vertex), "vertex <" + vertex + "> already exists");

	if(typeof vertex === "string") {
		vertex = new Vertex(vertex, weight, [], []);
	}

	this.vertices.push(vertex);
};

Graph.prototype.remove_vertex = function remove_vertex(vertex) {
	ASSERT_IS_STRING(vertex);
	ASSERT(this.has_vertex(vertex), "cannot remove vertex <" + vertex + "> that is not part of the graph");

	var vertex_obj = this.get_vertex_by_name(vertex);

	var i, l;

	// TODO: this could be done waaay.... more efficient
	var neighbours_out = vertex_obj.neighbours_out.slice();
	for(i = 0, l = neighbours_out.length; i < l; ++i) {
		this.remove_edge(vertex, neighbours_out[i]);
	}

	var neighbours_in = vertex_obj.neighbours_in.slice();
	for(i = 0, l = neighbours_in.length; i < l; ++i) {
		this.remove_edge(neighbours_in[i], vertex);
	}

	this.vertices.splice(this.vertices.indexOf(vertex_obj), 1);
};

/**
 * Add a directed edge to the graph.
 *
 * Note that the same edge can be added multiple times to form
 * a multigraph.
 */
Graph.prototype.add_edge = function add_edge(vertex1, vertex2) {
	ASSERT_IS_STRING(vertex1);
	ASSERT_IS_STRING(vertex2);
	ASSERT(this.has_vertex(vertex1));
	ASSERT(this.has_vertex(vertex2));

	var vertex1_obj = this.get_vertex_by_name(vertex1);
	var vertex2_obj = this.get_vertex_by_name(vertex2);

	ASSERT(vertex1_obj instanceof Vertex && vertex1_obj !== null);
	ASSERT(vertex2_obj instanceof Vertex && vertex2_obj !== null);

	vertex1_obj.neighbours_out.push(vertex2);
	vertex2_obj.neighbours_in.push(vertex1);
};

Graph.prototype.remove_edge = function remove_edge(vertex1, vertex2) {
	ASSERT_IS_STRING(vertex1);
	ASSERT_IS_STRING(vertex2);
	ASSERT(this.has_vertex(vertex1));
	ASSERT(this.has_vertex(vertex2));

	var vertex1_obj = this.get_vertex_by_name(vertex1);
	var vertex2_obj = this.get_vertex_by_name(vertex2);

	ASSERT(vertex1_obj instanceof Vertex && vertex1_obj !== null);
	ASSERT(vertex2_obj instanceof Vertex && vertex2_obj !== null);
	ASSERT(vertex1_obj.neighbours_out.indexOf(vertex2) !== -1);
	ASSERT(vertex2_obj.neighbours_in.indexOf(vertex1) !== -1);

	vertex2_obj.neighbours_in.splice(vertex2_obj.neighbours_in.indexOf(vertex1), 1);
	vertex1_obj.neighbours_out.splice(vertex1_obj.neighbours_out.indexOf(vertex2), 1);
};

/**
 * Test whether the graph has a vertex with the given name.
 *
 * @param {string|Vertex} a vertex name or `Vertex` object
 */
Graph.prototype.has_vertex = function has_vertex(vertex) {
	ASSERT(typeof vertex === "string" || vertex instanceof Vertex);

	if(vertex instanceof Vertex) {
		vertex = vertex.id;
	}

	return this.get_vertex_by_name(vertex) !== null;
};

Graph.prototype.get_vertex_by_name = function get_vertex_by_name(id) {
	ASSERT_IS_STRING(id);

	for(var i = 0, l = this.vertices.length; i < l; ++i) {
		if(this.vertices[i].id === id) {
			return this.vertices[i];
		}
	}

	return null;
};

Graph.prototype.has_edge = function has_edge(vertex1, vertex2) {

	if(typeof vertex1 === "string") {
		vertex1 = this.get_vertex_by_name(vertex1);
	}

	if(vertex2 instanceof Vertex) {
		var vertex2_index = this.vertices.indexOf(vertex2);

		if(vertex2_index === -1) {
			return false;
		}

		vertex2 = this.vertices[vertex2_index].id;
	}

	ASSERT(vertex1 instanceof Vertex);
	ASSERT_IS_STRING(vertex2);

	return vertex1.neighbours_out.indexOf(vertex2) !== -1;
};

Graph.prototype.has_cycle = function has_cycle() {
	var itr = new DepthFirstGraphIterator(this);

	while(itr.next()) {
		if(itr.current_edge_type() === DepthFirstGraphIterator.EDGE_BACK) {
			return true;
		}
	}

	return false;
};

/**
 * Returns all vertices with no ingoing edges (indegree = 0).
 */
Graph.prototype.get_root_vertices = function get_root_vertices() {
	var has_in_edge = {}, roots = [];

	for(var i = 0, l = this.vertices.length; i < l; ++i) {
		for(var n = 0, ns = this.vertices[i].neighbours_out.length; n < ns; ++n) {
			has_in_edge[this.vertices[i].neighbours_out[n]] = true;
		}
	}

	for(i = 0, l = this.vertices.length; i < l; ++i) {
		if(!has_in_edge[this.vertices[i].id]) {
			roots.push(this.vertices[i]);
		}
	}

	return roots;
};

/**
 * Returns all vertices with no outgoing edges (outdegree = 0).
 *
 * @param {Vertex|string} parentNode limits the leaf search to all vertices
 * that are reachable from parentNode
 */
Graph.prototype.get_leaf_vertices = function get_leaf_vertices(/* parentNode*/) {
	var has_out_edge = {}, leafs = [];

	for(var i = 0, l = this.vertices.length; i < l; ++i) {
		for(var n = 0, ns = this.vertices[i].neighbours_in.length; n < ns; ++n) {
			has_out_edge[this.vertices[i].neighbours_in[n]] = true;
		}
	}

	for(i = 0, l = this.vertices.length; i < l; ++i) {
		if(!has_out_edge[this.vertices[i].id]) {
			leafs.push(this.vertices[i]);
		}
	}

	return leafs;
};


/* # Graph Iterator: Undefined Order
 */
function UndefinedOrderGraphIterator(graph) {
	ASSERT(graph instanceof Graph);

	this._graph = graph;
	this._curr = 0;
}

UndefinedOrderGraphIterator.prototype.next = function next() {
	return this._curr < this.graph.vertices.length ? this.vertices[this._curr++] : null;
};

UndefinedOrderGraphIterator.prototype.rewind = function rewind() {
	this._curr = 0;
};

/* # Graph Iterator: Depth First
 */
/**
 * Create a new iterator that traverses the graph depth first.
 *
 * Note that this iterator does only iterate over reachable vertices.  To reach
 * every node in the graph, restart the algorithm for each vertice that is
 * still white after the iterator was unwinded.
 *
 * Notet that this iterator iterates over all edges! vertices may be seen
 * several times. If you want to visit each vertex just once, skip all
 * edges, that are not tree edges.
 */
function DepthFirstGraphIterator(graph, start_vertex) {
	ASSERT(graph instanceof Graph);

	start_vertex = start_vertex || graph.vertices[0];

	if(typeof start_vertex === "string") {
		start_vertex = graph.get_vertex_by_name(start_vertex);
	}

	ASSERT(start_vertex instanceof Vertex);

	this.graph = graph;

	this._color = {};

	this._index = {};
	this._index[start_vertex.id] = 0;

	this._start_vertex = start_vertex;
	this._stack = [start_vertex];

	this._curr_edge_type = null;
	this._curr_edge = null;
}

DepthFirstGraphIterator.VERTEXCOLOR_WHITE = "WHITE";
DepthFirstGraphIterator.VERTEXCOLOR_GRAY  = "GRAY";
DepthFirstGraphIterator.VERTEXCOLOR_BLACK = "BLACK";

DepthFirstGraphIterator.EDGE_BACK = "EDGE_BACK";
DepthFirstGraphIterator.EDGE_TREE = "EDGE_TREE";
DepthFirstGraphIterator.EDGE_FORWARD_OR_CROSS = "EDGE_FORWARD_OR_CROSS";

DepthFirstGraphIterator.prototype.next = function next() {

	// empty graph or done
	if(this._stack.length === 0) {
		return null;
	}

	var curr = this._stack[this._stack.length - 1];

	this._color[curr.id] = DepthFirstGraphIterator.VERTEXCOLOR_GRAY;

	var i = this._index[curr.id];
	++this._index[curr.id];

	if(i < curr.neighbours_out.length) {
		// there is another child/neighbour to examine
		var curr_neigh = this.graph.get_vertex_by_name(curr.neighbours_out[i]);
		this._curr_edge = [curr, curr_neigh];
		var color = this._color[curr_neigh.id];

		// if the child is a white vertex (new unprocessed vertex)
		if(color === undefined) 
		{
			this._curr_edge_type = DepthFirstGraphIterator.EDGE_TREE;

			// traverse recursive
			this._stack.push(curr_neigh);
			this._index[curr_neigh.id] = 0;

		} else if(color === DepthFirstGraphIterator.VERTEXCOLOR_GRAY) {
			this._curr_edge_type = DepthFirstGraphIterator.EDGE_BACK;
		} else { // black
			this._curr_edge_type = DepthFirstGraphIterator.EDGE_FORWARD_OR_CROSS;
		}

		return curr_neigh;
	} else {
		// there are no more children, finish vertex and try parent of current
		this._stack.pop();
		this._color[curr.id] = DepthFirstGraphIterator.VERTEXCOLOR_BLACK;

		return this.next();
	}
};

DepthFirstGraphIterator.prototype.current_edge_type = function current_edge_type() {
	return this._curr_edge_type;
};

DepthFirstGraphIterator.prototype.current_edge = function current_edge_type() {
	return this._curr_edge;
};

DepthFirstGraphIterator.prototype.vertex_color = function vertex_color(vertex) {

	if(vertex instanceof Vertex) {
		vertex = vertex.id;
	}

	ASSERT_IS_STRING(vertex);

	return this._color[vertex] || DepthFirstGraphIterator.VERTEXCOLOR_WHITE;
};

})(this);
