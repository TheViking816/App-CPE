variable "tenancy_ocid" {
  description = "OCID del tenancy de Oracle Cloud"
  type        = string
}

variable "user_ocid" {
  description = "OCID del usuario de Oracle Cloud"
  type        = string
}

variable "api_key_fingerprint" {
  description = "Fingerprint de la clave API del usuario"
  type        = string
}

variable "api_private_key_path" {
  description = "Ruta local absoluta a la clave privada PEM de Oracle"
  type        = string
}

variable "compartment_ocid" {
  description = "OCID del compartment donde crear los recursos"
  type        = string
}

variable "region" {
  description = "Region principal de la cuenta, por ejemplo eu-madrid-1"
  type        = string
}

variable "ssh_public_key" {
  description = "Clave publica SSH autorizada para administrar la instancia"
  type        = string
}

variable "availability_domain_index" {
  description = "Dominio de disponibilidad; cambiarlo si Oracle indica falta de capacidad"
  type        = number
  default     = 0
}

variable "app_repository_url" {
  type    = string
  default = "https://github.com/TheViking816/App-CPE.git"
}

variable "app_repository_branch" {
  type    = string
  default = "codex/oracle-arm-workers"
}

variable "portal_repository_url" {
  type    = string
  default = "https://github.com/TheViking816/PortalEstibaVLC.git"
}

variable "portal_repository_branch" {
  type    = string
  default = "codex/oracle-arm-contracting"
}
