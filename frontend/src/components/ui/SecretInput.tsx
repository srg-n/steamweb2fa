import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';

/**
 * Parola / sır girilen alan.
 *
 * Bilerek *kontrollü* değildir: `value` özelliği verilmez. Kontrollü bir React
 * input'unda yazılan metin her render'da `value` **özniteliğine** de yazılır,
 * yani parola `document.documentElement.outerHTML` içinde okunabilir hâle
 * gelir (DOM dökümleri, eklentiler, hata raporları). Burada değer yalnızca
 * input'un kendi durumunda durur; çağıran `ref` üzerinden okuyup işledikten
 * sonra temizler.
 *
 * Kullanım:
 *   const ref = useRef<HTMLInputElement>(null);
 *   ... <SecretInput ref={ref} /> ...
 *   const value = ref.current?.value ?? '';
 */
export const SecretInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function SecretInput({ className, ...props }, ref) {
    return <input ref={ref} type="password" className={clsx('input-base', className)} {...props} />;
  }
);
