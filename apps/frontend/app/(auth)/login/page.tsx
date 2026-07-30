import Image from 'next/image';
import { LoginButton } from '../../../components/LoginButton';

export default function LoginPage() {
  return (
    <main className="login-page">
      <div className="login-hero">
        <Image src="/logo-hero.png" alt="Ai-Mail-priority" width={360} height={284} priority />
        <p className="login-hero__tagline">จัดหมวดหมู่และลำดับความสำคัญอีเมลอัตโนมัติด้วย Claude</p>
        <LoginButton />
      </div>
    </main>
  );
}
