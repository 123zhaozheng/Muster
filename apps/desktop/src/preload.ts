// 预加载脚本：仅向渲染进程暴露只读的平台信息。
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("muster", {
  platform: process.platform,
  version: process.versions.electron,
});
