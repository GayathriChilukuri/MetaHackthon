param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$stockwiseVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$stockwiseVoice.Rate = 0
$stockwiseOutput = Join-Path $ProjectRoot 'output\video'
New-Item -ItemType Directory -Force -Path $stockwiseOutput | Out-Null
$stockwiseScenes = Get-Content -LiteralPath (Join-Path $ProjectRoot 'docs\video-storyboard.json') -Raw | ConvertFrom-Json
for ($stockwiseIndex = 0; $stockwiseIndex -lt $stockwiseScenes.Count; $stockwiseIndex++) {
    $stockwiseAudioPath = Join-Path $stockwiseOutput ('voice-{0:d2}.wav' -f $stockwiseIndex)
    $stockwiseVoice.SetOutputToWaveFile($stockwiseAudioPath)
    $stockwiseVoice.Speak($stockwiseScenes[$stockwiseIndex].text)
    $stockwiseVoice.SetOutputToNull()
}
$stockwiseVoice.Dispose()
Write-Output 'Local narration generated.'
