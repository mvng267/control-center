# Formula Homebrew cho dashboard này.
#
# Cài:
#   brew tap mvng267/control https://github.com/mvng267/control-center
#   brew install --HEAD mvng267/control/control
#
# Hoặc cài bằng npm, không cần Homebrew:
#   npm i -g claude-control-center && control
#
# Chạy nền, tự bật lại khi đăng nhập:
#   brew services start control
#   brew services restart control     # sau khi brew upgrade
#   brew services stop control
#
# Cập nhật:
#   brew upgrade --fetch-HEAD mvng267/control/control
#
# Vì sao head-only, không có bản đóng gói:
#   `url` cố định bắt phải cắt tag và tính sha256 mỗi lần sửa. HEAD kéo thẳng nhánh
#   main, hợp với nhịp phát hành của dự án này.
class Control < Formula
  desc "Dashboard quản lý phiên Claude CLI, Hermes, agy-proxy và Docker"
  homepage "https://github.com/mvng267/control-center"
  head "https://github.com/mvng267/control-center.git", branch: "main"
  license "MIT"

  # Bắt buộc, KHÔNG :recommended: script chạy trỏ cứng vào node của Homebrew, mà
  # :recommended cho phép bỏ qua bằng --without-node -> trỏ vào đường dẫn không có gì.
  # Máy dev mặc định có thể dùng Node của Hermes (~/.local/bin/node) nên không thể trông chờ
  # `node` trong PATH là bản đúng.
  depends_on "node"

  def install
    # Backend zero-dependency và web-next/out đã build sẵn trong repo, nên chỉ cần
    # copy nguyên cây. KHÔNG chạy npm install: không có dependency runtime nào.
    libexec.install Dir["*"]

    # Script chạy: giữ nguyên cwd của người dùng, chỉ trỏ Node vào server trong libexec.
    (bin/"control").write <<~SH
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/src/server/index.js" "$@"
    SH
    chmod 0755, bin/"control"
  end

  service do
    run [opt_bin/"control"]
    keep_alive true
    working_dir HOMEBREW_PREFIX
    log_path var/"log/control.log"
    error_log_path var/"log/control.log"
    environment_variables PORT: "7799"
  end

  def caveats
    <<~TEXT
      Dashboard đọc dữ liệu từ ~/.claude của Claude CLI trên CHÍNH máy này —
      cài lên máy chưa dùng Claude CLI thì mở ra sẽ trống.

      Mã truy cập sinh ở lần chạy đầu, lưu tại ~/.claude/dashboard-token.json.
      Xem bằng:  cat ~/.claude/dashboard-token.json

      Chạy nền:  brew services start control
      Log:       #{var}/log/control.log
      Mở:        http://localhost:7799
    TEXT
  end

  test do
    # Chỉ kiểm server dựng lên và trả lời được — không đụng ~/.claude thật.
    port = free_port
    pid = spawn({ "PORT" => port.to_s, "HOME" => testpath.to_s }, bin/"control")
    begin
      sleep 3
      assert_match "ok", shell_output("curl -s http://127.0.0.1:#{port}/api/passcode/status")
    ensure
      Process.kill "TERM", pid
      Process.wait pid
    end
  end
end
