import { createContext, useContext } from 'react';
import { translator, type Translate } from './dictionary';

export const I18nContext = createContext<Translate>(translator('ko'));

export const useT = () => useContext(I18nContext);
