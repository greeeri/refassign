update public.development_questions as question
set responder_name = trim(concat_ws(' ', mentor.first_name, mentor.last_name))
from public.officials as mentor
where question.responded_by = mentor.auth_user_id
  and nullif(trim(concat_ws(' ', mentor.first_name, mentor.last_name)), '') is not null
  and question.responder_name is distinct from trim(concat_ws(' ', mentor.first_name, mentor.last_name));
