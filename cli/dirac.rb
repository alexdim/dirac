# IMPORTANT: `npm run postpublish` to update this file after publishing a new version of the package
class Dirac < Formula
  desc "Autonomous coding agent CLI - capable of creating/editing files, running commands, and more"
  homepage "https://dirac.run"
  url "https://registry.npmjs.org/dirac-cli/-/dirac-cli-0.4.35.tgz" # GET from https://registry.npmjs.org/dirac-cli/latest tarball URL
  sha256 "d6c8abbad891e5b1ce68399653cbb4eaa344b682b1eb3b08da73bcdf09ee9d31"
  license :cannot_represent

  depends_on "node@22"
  depends_on "ripgrep"

  def install
    system "npm", "install", *std_npm_args(prefix: false)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # Test that the binary exists and is executable
    assert_match version.to_s, shell_output("#{bin}/dirac --version")
  end
end
