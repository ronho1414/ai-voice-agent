import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { activePreferences, managedFailure, serviceDatabase } from "@/lib/platform/managed-agent-service";

export const GET = withPlatformRequest(async request => {
 const session=await requireCustomerAuth(request); if(session instanceof Response)return session;
 try {
  const {data:agents,error}=await serviceDatabase().from('agents').select('name,status,voice_name,language_mode,config').eq('organization_id',session.organizationId!).order('created_at').order('id').limit(1);
  if(error)throw error;
  const agent=agents?.[0],config=agent?.config??{};
  const languages:Record<string,string>={cantonese:'廣東話',english:'英語',mandarin:'普通話'};
  return Response.json({agent:{name:agent?.name||'AI 接待專員',status_label:agent?.status==='inactive'?'服務已停用':'服務狀態待 Orai 確認',languages:agent?.language_mode==='trilingual'?['廣東話','英語','普通話']:agent?.language_mode?[languages[agent.language_mode]||'待確認']:[],voice_name:typeof config.confirmed_voice_name==='string'?config.confirmed_voice_name:null,service_mode:'Orai 託管接待服務',availability_24_7:config.availability_24_7===true?true:null},preferences:await activePreferences(request,session.organizationId!)});
 }catch(e){return managedFailure(e);}
});
// Legacy customer instructions remain in agents.config for administrative review.
// Customer PATCH is intentionally retired; requests never write live configuration.
