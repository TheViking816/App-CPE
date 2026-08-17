resource "hcloud_ssh_key" "admin" {
  name       = "app-cpe-vps-admin"
  public_key = var.ssh_public_key
}

resource "hcloud_firewall" "worker" {
  name = "app-cpe-vps-worker"

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_primary_ip" "worker" {
  name        = "app-cpe-portal-worker-ipv4"
  location    = var.location
  type        = "ipv4"
  auto_delete = false
}

resource "hcloud_server" "worker" {
  name         = "app-cpe-portal-worker"
  image        = "ubuntu-24.04"
  server_type  = var.server_type
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.worker.id]

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.worker.id
    ipv6_enabled = true
  }

  user_data = templatefile("${path.module}/cloud-init.tftpl", {
    repository_url    = var.repository_url
    repository_branch = var.repository_branch
  })
}
