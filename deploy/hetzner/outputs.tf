output "ipv4" {
  description = "IP publica estable mientras exista el servidor"
  value       = hcloud_primary_ip.worker.ip_address
}

output "ssh_command" {
  value = "ssh root@${hcloud_primary_ip.worker.ip_address}"
}

output "desktop_tunnel" {
  value = "ssh -L 6080:127.0.0.1:6080 root@${hcloud_primary_ip.worker.ip_address}"
}
