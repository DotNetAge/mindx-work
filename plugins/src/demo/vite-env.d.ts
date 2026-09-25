/// <reference types="vite/client" />

/** 静态资源（svg/png）导入的模块声明（Vite 客户端类型） */
declare module '*.svg' {
  const src: string
  export default src
}
