import UserCard from '../components/UserCard'
import '../styles.css'
interface User { name: string; email: string; status: string }
declare const users: User[]
declare const loading: boolean
declare const error: boolean
export default function Users() {
  if (loading) return <main><h1>Loading users</h1></main>
  if (error) return <main><h1>Users could not be loaded</h1></main>
  if (users.length === 0) return <main><h1>No users yet</h1></main>
  return <main><h1>Our team</h1><section className="cards">{users.map(user => <UserCard name={user.name} email={user.email} />)}</section></main>
}
