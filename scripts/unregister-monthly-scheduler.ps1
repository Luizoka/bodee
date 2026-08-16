param(
  [string]$TaskName = 'FaturaSync - Agendamento Mensal'
)

$ErrorActionPreference = 'Stop'
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Output "Tarefa '$TaskName' removida."
