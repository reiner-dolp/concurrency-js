A library for easy web worker interaction.


__Minimal Usage Example:__ Increments 1 and prints it to the console.

```js
var pool = new WorkerPool();
pool.events.on("worker_done", i => console.log("Message from worker:", i));
pool.run_task(new Task(i => i+1, 1));
```

# API Overview

### class Workerpool
####Constructor
```
new WorkerPool(
     worker_scripts :string[],
     worker_count   :number,
     lookup_table?  :string[]
)
```
####add_packer()

By default ArrayBuffer and all TypedArrays can be transfered without loosing
their type.

####add_unpacker()

####run_task()

####terminate()

####is_terminated()

### class Task
### class Pipeline

# Notes on Web Workers

