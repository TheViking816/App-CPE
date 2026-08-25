update public.app_cpe_forum_messages
set message = 'Bienvenidos al foro de App CPE. La aplicación todavía está en fase beta. Podéis comentar aquí cualquier error o fallo para que podamos revisarlo. Este espacio también es vuestro para hablar y compartir lo que queráis entre compañeros.'
where author_chapa = '72683'
  and message like 'Bienvenidos al foro de App CPE.%';
