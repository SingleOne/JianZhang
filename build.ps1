npm run build
if ($LASTEXITCODE -eq 0) {
  .\node_modules\.bin\electron-builder.cmd --config electron-builder.config.cjs --win --dir
}