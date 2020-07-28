/* @flow */

// 异步函数队列化执行的方法
export function runQueue (
  queue: Array<?NavigationGuard>, // 需要异步执行的队列
  fn: Function, // 执行队列每个元素的方法
  cb: Function // 所有任务执行完毕的回调函数
) {
  // 通过 index 来记录队列执行的进度
  const step = index => {
    if (index >= queue.length) { // index 大于了队列的长度，调用任务所有执行完毕的回调函数
      cb()
    } else {
      if (queue[index]) {
        fn(queue[index], () => {
          step(index + 1)
        })
      } else {
        step(index + 1)
      }
    }
  }
  // 从队列第一个元素开始
  step(0)
}
