// 接收「从其他应用打开」传进来的文件
// 原生侧（MainActivity）把收到的文件原样写到 cache 目录，这里读走即删
import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { decodeBytes } from './importer'

// 与 MainActivity.PENDING_FILE 保持一致
const PENDING_FILE = 'pending-import.bin'

// 待导入的文本，由 App.vue 写入、Import.vue 消费
export const pendingImportText = ref('')

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// 读取并删除待处理文件；没有则返回空字符串
export async function takePendingFile() {
  if (!Capacitor.isNativePlatform()) return ''

  try {
    await Filesystem.stat({ path: PENDING_FILE, directory: Directory.Cache })
  } catch {
    return ''
  }

  try {
    // 不传 encoding 时 readFile 返回 base64，避免插件按默认格式解码出错
    const res = await Filesystem.readFile({ path: PENDING_FILE, directory: Directory.Cache })
    const base64 = typeof res.data === 'string' ? res.data : ''
    if (!base64) return ''
    return decodeBytes(base64ToBytes(base64))
  } catch {
    return ''
  } finally {
    Filesystem.deleteFile({ path: PENDING_FILE, directory: Directory.Cache }).catch(() => {})
  }
}
