output "public_ip" {
  description = "IPv4 publica de la instancia mientras esta exista"
  value       = oci_core_instance.worker.public_ip
}

output "ssh_command" {
  value = "ssh ubuntu@${oci_core_instance.worker.public_ip}"
}

output "desktop_tunnel" {
  value = "ssh -L 6080:127.0.0.1:6080 ubuntu@${oci_core_instance.worker.public_ip}"
}
