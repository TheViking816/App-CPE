variable "hcloud_token" {
  description = "Token de API de Hetzner Cloud"
  type        = string
  sensitive   = true
}

variable "ssh_public_key" {
  description = "Clave publica SSH autorizada para administrar el VPS"
  type        = string
}

variable "server_type" {
  description = "Tamano x86 del VPS; CX43 aporta 8 vCPU y 16 GB"
  type        = string
  default     = "cx43"
}

variable "location" {
  description = "Centro de datos europeo"
  type        = string
  default     = "nbg1"
}

variable "repository_url" {
  type    = string
  default = "https://github.com/TheViking816/App-CPE.git"
}

variable "repository_branch" {
  type    = string
  default = "codex/vps-portal-worker"
}
