/** demo 插件内部状态：一律 Pinia（界面层选型定稿） */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

interface Task {
  id: number
  title: string
  done: boolean
}

export const useTaskStore = defineStore('demo-tasks', () => {
  const tasks = ref<Task[]>([
    { id: 1, title: '搭出基本壳并跑通六视图区', done: true },
    { id: 2, title: '接入 daemon-link 服务插件', done: false },
    { id: 3, title: 'Electron 薄壳包窗口', done: false },
  ])
  let nextId = 4

  const add = (title: string) => {
    const trimmed = title.trim()
    if (trimmed) {
      tasks.value.push({ id: nextId++, title: trimmed, done: false })
    }
  }
  const toggle = (id: number) => {
    const task = tasks.value.find((item) => item.id === id)
    if (task) task.done = !task.done
  }
  const remove = (id: number) => {
    tasks.value = tasks.value.filter((item) => item.id !== id)
  }
  const doneCount = computed(() => tasks.value.filter((item) => item.done).length)

  return { tasks, add, toggle, remove, doneCount }
})
