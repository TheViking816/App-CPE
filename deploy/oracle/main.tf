data "oci_identity_availability_domains" "available" {
  compartment_id = var.tenancy_ocid
}

locals {
  availability_domain = data.oci_identity_availability_domains.available.availability_domains[var.availability_domain_index].name
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "24.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_vcn" "worker" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = ["10.71.0.0/16"]
  display_name   = "app-cpe-oracle-worker"
  dns_label      = "appcpeworker"
}

resource "oci_core_internet_gateway" "worker" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.worker.id
  display_name   = "app-cpe-worker-internet"
  enabled        = true
}

resource "oci_core_route_table" "worker" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.worker.id
  display_name   = "app-cpe-worker-public-route"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.worker.id
  }
}

resource "oci_core_security_list" "worker" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.worker.id
  display_name   = "app-cpe-worker-ssh-only"

  ingress_security_rules {
    protocol = "6"
    source   = "0.0.0.0/0"

    tcp_options {
      min = 22
      max = 22
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
  }
}

resource "oci_core_subnet" "worker" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.worker.id
  cidr_block                 = "10.71.1.0/24"
  display_name               = "app-cpe-worker-public"
  dns_label                  = "worker"
  route_table_id             = oci_core_route_table.worker.id
  security_list_ids          = [oci_core_security_list.worker.id]
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_instance" "worker" {
  availability_domain = local.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "app-cpe-oracle-worker"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  create_vnic_details {
    assign_public_ip = true
    subnet_id        = oci_core_subnet.worker.id
    display_name     = "app-cpe-oracle-worker"
    hostname_label   = "appcpe"
  }

  source_details {
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu_arm.images[0].id
    boot_volume_size_in_gbs = 50
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key
    user_data = base64encode(templatefile("${path.module}/cloud-init.tftpl", {
      app_repository_url       = var.app_repository_url
      app_repository_branch    = var.app_repository_branch
      portal_repository_url    = var.portal_repository_url
      portal_repository_branch = var.portal_repository_branch
    }))
  }

  preserve_boot_volume = false
}
