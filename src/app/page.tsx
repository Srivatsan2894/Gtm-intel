'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const profileId = localStorage.getItem('gtm_profile_id')
    if (profileId) {
      router.push('/dashboard')
    } else {
      router.push('/setup')
    }
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
