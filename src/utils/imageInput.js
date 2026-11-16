// 图片预处理：把相册或拍照拿到的文件转成 data URL
//
// 为什么要压：
//   1. DeepSeek 对单张图片的 token 有 1024 上限，服务端会把大图缩到等效 1300×1300，
//      本地保留原图没有任何 token 收益，只是白白增加上传耗时
//   2. 请求体上限 48 MiB，超大原图会直接失败
// 压缩不会降低识别质量：账单截图缩到 1600 长边后，服务端再缩一次，两次缩放的效果
// 明显好于「原图直传被缩一次 + 巨大请求体」的间接成本。

// 服务端等效 1300，这里留一点余量，避免本地先缩出锯齿
const MAX_SIDE = 1600
const QUALITY = 0.82
// 单张压完后仍超过这个尺寸就再降一档质量，防止极端长截图撑爆请求
const MAX_BYTES = 3 * 1024 * 1024

function fitSize(width, height, maxSide) {
  const longest = Math.max(width, height)
  if (longest <= maxSide) return { width, height }
  const scale = maxSide / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

// createImageBitmap 在多数 WebView 上可用，失败时退回 <img> + objectURL
async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // 部分机型对 HEIC 等格式不支持，走下面的回退
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图片读不出来，换一张试试'))
    }
    img.src = url
  })
}

function drawToDataUrl(bitmap, size, quality) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  // 铺白底：截图通常是 PNG，若有透明通道，转 JPEG 后透明区会变黑
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  return canvas.toDataURL('image/jpeg', quality)
}

function base64LengthOf(dataUrl) {
  const idx = String(dataUrl).indexOf(',')
  return idx < 0 ? 0 : Math.round((dataUrl.length - idx - 1) * 0.75)
}

/**
 * 把用户选的图片文件转成可直接塞进 image_url 的 data URL
 * @returns {Promise<{ dataUrl: string, width: number, height: number, bytes: number }>}
 */
export async function fileToImagePayload(file) {
  if (!file) throw new Error('没有选中图片')
  if (!/^image\//.test(file.type || '')) throw new Error('只能选图片文件')

  const bitmap = await loadBitmap(file)
  const originSize = { width: bitmap.width, height: bitmap.height }
  const size = fitSize(originSize.width, originSize.height, MAX_SIDE)

  let quality = QUALITY
  let dataUrl = drawToDataUrl(bitmap, size, quality)
  // 长截图压完仍偏大时再降一档，最多两次，避免无限循环
  for (let i = 0; i < 2 && base64LengthOf(dataUrl) > MAX_BYTES; i++) {
    quality -= 0.15
    dataUrl = drawToDataUrl(bitmap, size, quality)
  }
  if (typeof bitmap.close === 'function') bitmap.close()

  return {
    dataUrl,
    width: size.width,
    height: size.height,
    bytes: base64LengthOf(dataUrl)
  }
}
