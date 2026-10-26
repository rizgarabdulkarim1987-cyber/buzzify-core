import { redirect } from 'next/navigation';

/** The Menu Styles area moved into the Templates gallery (Menus, Design, Styles filter); old links lead to the menus. */
export default function StylesMoved(): never {
  redirect('/studio/menus');
}
