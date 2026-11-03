# Start, stop or inspect the predev agent container.
#
#   .\scripts\predev-agent.ps1 status
#   .\scripts\predev-agent.ps1 stop     # sleep until you test
#   .\scripts\predev-agent.ps1 start
#
# Predev shares the production VM, so stopping it between sessions leaves the
# whole e2-small to the production agent.
param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "status"
)

$vm = "meetingbot-agent-vm"
$zone = "asia-south1-a"
$project = "siva-nikhil"
$name = "agent-predev"

switch ($Action) {
  "status" {
    gcloud compute ssh $vm --zone $zone --project $project --quiet `
      --command "sudo docker ps -a --filter name=$name --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'"
  }
  "stop" {
    gcloud compute ssh $vm --zone $zone --project $project --quiet `
      --command "sudo docker stop $name && sudo docker ps -a --filter name=$name --format '{{.Names}} {{.Status}}'"
  }
  "start" {
    gcloud compute ssh $vm --zone $zone --project $project --quiet `
      --command "sudo bash ~/predev-agent-vm.sh"
  }
}
