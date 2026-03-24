# survey-app
Form Generator

survey-app/  
 ├── docker-compose.yml  
 ├── supabase/          # официальный self-hosted  
 ├── frontend/          # React + SurveyJS  
 │    ├── Dockerfile  
 │    ├── src/  
 │    │    ├── pages/  
 │    │    │    ├── Builder.tsx  
 │    │    │    ├── Form.tsx  
 │    │    │    ├── FormsList.tsx  
 │    │    ├── lib/supabase.ts  
 │    │    ├── App.tsx  

git clone https://github.com/supabase/supabase  
cp -r supabase/docker ./supabase

# Запуск
docker compose up --build

http://localhost:3000

create table forms (  
  id uuid primary key default gen_random_uuid(),  
  title text,  
  form_type text,  
  form_reason text,  
  schema jsonb,  
  created_at timestamp default now()  
);  

create table responses (  
  id uuid primary key default gen_random_uuid(),  
  form_id uuid,  
  data jsonb,  
  created_at timestamp default now()  
);  
