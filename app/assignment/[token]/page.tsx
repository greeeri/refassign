import AssignmentResponse from '../../../components/AssignmentResponse'

export default async function AssignmentResponsePage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params
  return <AssignmentResponse token={token}/>
}
