package com.bookkeeping.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

  // 收到外部文件后原样落盘，前端读走即删。放 cache 目录，不需要任何存储权限。
  public static final String PENDING_FILE = "pending-import.bin";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleIncomingFile(getIntent());
  }

  // launchMode 为 singleTask：应用已在后台时走这里，不会重建 Activity
  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    handleIncomingFile(intent);
  }

  /**
   * 微信 / QQ / 文件管理器里「用其他应用打开」会发 ACTION_VIEW + content:// URI。
   * 内容不做任何解码，原样写盘，编码判断统一交给前端（CSV 可能是 UTF-16、GBK 或 UTF-8）。
   */
  private void handleIncomingFile(Intent intent) {
    if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
    Uri uri = intent.getData();
    if (uri == null) return;

    try (InputStream in = getContentResolver().openInputStream(uri)) {
      if (in == null) return;
      ByteArrayOutputStream buffer = new ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int read;
      while ((read = in.read(chunk)) != -1) {
        buffer.write(chunk, 0, read);
      }
      byte[] data = buffer.toByteArray();
      if (data.length == 0) return;

      File target = new File(getCacheDir(), PENDING_FILE);
      try (FileOutputStream out = new FileOutputStream(target)) {
        out.write(data);
      }
      notifyWebView();
    } catch (Exception ignored) {
      // provider 未授权或文件已失效，当作没收到，不打断启动流程
    }
  }

  private void notifyWebView() {
    if (bridge == null || bridge.getWebView() == null) return;
    bridge.getWebView().post(() -> {
      if (bridge.getWebView() != null) {
        bridge.getWebView().evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('wulong-native-file'))", null);
      }
    });
  }
}
