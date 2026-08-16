param(
  [ValidateRange(1, 28)]
  [int]$Day = 5,

  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$At = '08:00',

  [string]$TaskName = 'FaturaSync - Agendamento Mensal'
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $projectDirectory 'scripts\run-monthly-scheduler.cmd'
$logFile = Join-Path $projectDirectory 'output\scheduler.log'
if (-not (Test-Path $runner)) {
  throw "Arquivo de execução não encontrado: $runner"
}

# Algumas versões do Windows não oferecem trigger mensal no cmdlet
# New-ScheduledTaskTrigger. O XML permite criar esse trigger e preserva paths
# com espaços ao executar o .cmd pelo cmd.exe.
$now = Get-Date
$atTime = [DateTime]::ParseExact($At, 'HH:mm', $null)
$start = Get-Date -Year $now.Year -Month $now.Month -Day $Day -Hour $atTime.Hour -Minute $atTime.Minute -Second 0
if ($start -le $now) { $start = $start.AddMonths(1) }
$escapedRunner = [System.Security.SecurityElement]::Escape($runner)
$months = @('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December') |
  ForEach-Object { "<$($_) />" }
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>$($start.ToString('s'))</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByMonth><DaysOfMonth><Day>$Day</Day></DaysOfMonth><Months>$($months -join '')</Months></ScheduleByMonth>
    </CalendarTrigger>
  </Triggers>
  <Principals><Principal id="Author"><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><StartWhenAvailable>true</StartWhenAvailable><Enabled>true</Enabled><Hidden>false</Hidden></Settings>
  <Actions Context="Author"><Exec><Command>cmd.exe</Command><Arguments>/d /c &quot;&quot;$escapedRunner&quot;&quot;</Arguments></Exec></Actions>
</Task>
"@
Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force | Out-Null

Write-Output "Tarefa '$TaskName' criada para o dia $Day às $At."
Write-Output "Log: $logFile"
Write-Output "Teste manual: schtasks /Run /TN '$TaskName'"
