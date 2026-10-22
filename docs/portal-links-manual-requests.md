# Solicitudes manuales de enlaces del portal

Disponible para todas las cuentas autenticadas. El modal está en Ajustes → Mis datos → Enlaces del portal. Cada cuenta guarda exclusivamente su propia contraseña recuperable en Vault y una solicitud privada pendiente; no actualiza las credenciales del worker, no accede al portal ni crea trabajos de sincronización.

El correo `admin_portal_links_requested` se entrega por el backend de correo existente a `portalestibavlc@gmail.com`, sin contraseña. Repetir la misma contraseña con una solicitud pendiente no crea otro aviso; los cambios están limitados a uno cada cinco minutos.

## Consulta del administrador

Desde el SQL Editor del proyecto App CPE, con permisos de administrador:

```sql
select r.chapa, r.status,
  r.updated_at at time zone 'Europe/Madrid' as guardada,
  s.decrypted_secret as contrasena_portal
from private.app_cpe_portal_link_requests r
join vault.decrypted_secrets s on s.id = r.password_secret_id
where r.status = 'pending'
order by r.updated_at;
```

La contraseña aparece en claro únicamente en esta consulta administrativa. No compartir su resultado ni incluirlo en correos. Las funciones accesibles desde App CPE solo devuelven estado y fecha, nunca el secreto.

Tras incorporar realmente los enlaces verificados, el administrador puede marcar la solicitud como completada:

```sql
update private.app_cpe_portal_link_requests
set status = 'linked', updated_at = now()
where chapa = '72683';
```

Esta marca no crea enlaces: solo debe aplicarse después de guardarlos por el procedimiento habitual. Los enlaces y sus copias existentes permanecen intactos.

Para guardar los accesos después de obtener un enlace personal válido del usuario, utiliza `scripts/sql/guardar-enlaces-portal.sql`: sustituye únicamente la chapa y el enlace al principio. Valida que coincidan, comprueba el pwd contra la contraseña guardada en Vault y guarda los componentes para los accesos que ya utiliza App CPE. La solicitud se marca como completada en la misma transacción. El SQL no abre el portal ni prueba las URL: primero debe verificarlas manualmente el administrador.
