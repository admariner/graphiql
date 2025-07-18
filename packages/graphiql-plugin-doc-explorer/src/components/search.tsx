import {
  GraphQLArgument,
  GraphQLField,
  GraphQLInputField,
  GraphQLNamedType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
} from 'graphql';
import { FC, useEffect, useRef, useState } from 'react';
import {
  Combobox,
  ComboboxInput,
  ComboboxOptions,
  ComboboxOption,
} from '@headlessui/react';
import {
  formatShortcutForOS,
  useGraphiQL,
  MagnifyingGlassIcon,
  debounce,
  KEY_MAP,
} from '@graphiql/react';
import { useDocExplorer, useDocExplorerActions } from '../context';
import { renderType } from './utils';
import './search.css';

export const Search: FC = () => {
  const explorerNavStack = useDocExplorer();
  const { push } = useDocExplorerActions();

  const inputRef = useRef<HTMLInputElement>(null!);
  const getSearchResults = useSearchResults();
  const [searchValue, setSearchValue] = useState('');
  const [results, setResults] = useState(() => getSearchResults(searchValue));
  const debouncedGetSearchResults = debounce(200, (search: string) => {
    setResults(getSearchResults(search));
  });
  // Workaround to fix React compiler error:
  // Ref values (the `current` property) may not be accessed during render.
  const [ref] = useState(inputRef);
  const isFocused = ref.current === document.activeElement;

  useEffect(() => {
    debouncedGetSearchResults(searchValue);
  }, [debouncedGetSearchResults, searchValue]);

  const navItem = explorerNavStack.at(-1)!;

  const onSelect = (def: TypeMatch | FieldMatch | null) => {
    // `null` when we remove search value
    if (!def) {
      return;
    }
    push(
      'field' in def
        ? { name: def.field.name, def: def.field }
        : { name: def.type.name, def: def.type },
    );
  };
  const shouldSearchBoxAppear =
    explorerNavStack.length === 1 ||
    isObjectType(navItem.def) ||
    isInterfaceType(navItem.def) ||
    isInputObjectType(navItem.def);
  if (!shouldSearchBoxAppear) {
    return null;
  }

  return (
    <Combobox
      as="div"
      className="graphiql-doc-explorer-search"
      onChange={onSelect}
      data-state={isFocused ? undefined : 'idle'}
      aria-label={`Search ${navItem.name}...`}
    >
      <div
        className="graphiql-doc-explorer-search-input"
        onClick={() => {
          inputRef.current.focus();
        }}
      >
        <MagnifyingGlassIcon />
        <ComboboxInput
          autoComplete="off"
          onChange={event => setSearchValue(event.target.value)}
          placeholder={formatShortcutForOS(
            formatShortcutForOS(KEY_MAP.searchInDocs.key).replaceAll('-', ' '),
          )}
          ref={inputRef}
          value={searchValue}
          data-cy="doc-explorer-input"
        />
      </div>
      {isFocused && (
        <ComboboxOptions data-cy="doc-explorer-list">
          {results.within.length +
            results.types.length +
            results.fields.length ===
          0 ? (
            <div className="graphiql-doc-explorer-search-empty">
              No results found
            </div>
          ) : (
            results.within.map((result, i) => (
              <ComboboxOption
                key={`within-${i}`}
                value={result}
                data-cy="doc-explorer-option"
              >
                <Field field={result.field} argument={result.argument} />
              </ComboboxOption>
            ))
          )}
          {results.within.length > 0 &&
          results.types.length + results.fields.length > 0 ? (
            <div className="graphiql-doc-explorer-search-divider">
              Other results
            </div>
          ) : null}
          {results.types.map((result, i) => (
            <ComboboxOption
              key={`type-${i}`}
              value={result}
              data-cy="doc-explorer-option"
            >
              <Type type={result.type} />
            </ComboboxOption>
          ))}
          {results.fields.map((result, i) => (
            <ComboboxOption
              key={`field-${i}`}
              value={result}
              data-cy="doc-explorer-option"
            >
              <Type type={result.type} />.
              <Field field={result.field} argument={result.argument} />
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      )}
    </Combobox>
  );
};

type TypeMatch = { type: GraphQLNamedType };

type FieldMatch = {
  type: GraphQLNamedType;
  field: GraphQLField<unknown, unknown> | GraphQLInputField;
  argument?: GraphQLArgument;
};

export function useSearchResults() {
  const explorerNavStack = useDocExplorer();
  const schema = useGraphiQL(state => state.schema);

  const navItem = explorerNavStack.at(-1)!;

  return (searchValue: string) => {
    const matches: {
      within: FieldMatch[];
      types: TypeMatch[];
      fields: FieldMatch[];
    } = {
      within: [],
      types: [],
      fields: [],
    };

    if (!schema) {
      return matches;
    }

    const withinType = navItem.def;

    const typeMap = schema.getTypeMap();
    let typeNames = Object.keys(typeMap);

    // Move the within type name to be the first searched.
    if (withinType) {
      typeNames = typeNames.filter(n => n !== withinType.name);
      typeNames.unshift(withinType.name);
    }
    for (const typeName of typeNames) {
      if (
        matches.within.length + matches.types.length + matches.fields.length >=
        100
      ) {
        break;
      }

      const type = typeMap[typeName]!;
      if (withinType !== type && isMatch(typeName, searchValue)) {
        matches.types.push({ type });
      }

      if (
        !isObjectType(type) &&
        !isInterfaceType(type) &&
        !isInputObjectType(type)
      ) {
        continue;
      }

      const fields = type.getFields();
      for (const fieldName in fields) {
        const field = fields[fieldName]!;
        let matchingArgs: GraphQLArgument[] | undefined;

        if (!isMatch(fieldName, searchValue)) {
          if ('args' in field) {
            matchingArgs = field.args.filter(arg =>
              isMatch(arg.name, searchValue),
            );
            if (matchingArgs.length === 0) {
              continue;
            }
          } else {
            continue;
          }
        }

        matches[withinType === type ? 'within' : 'fields'].push(
          ...(matchingArgs
            ? matchingArgs.map(argument => ({ type, field, argument }))
            : [{ type, field }]),
        );
      }
    }

    return matches;
  };
}

function isMatch(sourceText: string, searchValue: string): boolean {
  try {
    const escaped = searchValue.replaceAll(/[^_0-9A-Za-z]/g, ch => '\\' + ch);
    return new RegExp(escaped, 'i').test(sourceText);
  } catch {
    return sourceText.toLowerCase().includes(searchValue.toLowerCase());
  }
}

const Type: FC<{ type: GraphQLNamedType }> = ({ type }) => {
  return <span className="graphiql-doc-explorer-search-type">{type.name}</span>;
};

type FieldProps = {
  field: GraphQLField<unknown, unknown> | GraphQLInputField;
  argument?: GraphQLArgument;
};

const Field: FC<FieldProps> = ({ field, argument }) => {
  return (
    <>
      <span className="graphiql-doc-explorer-search-field">{field.name}</span>
      {argument ? (
        <>
          (
          <span className="graphiql-doc-explorer-search-argument">
            {argument.name}
          </span>
          :{' '}
          {renderType(argument.type, namedType => (
            <Type type={namedType} />
          ))}
          )
        </>
      ) : null}
    </>
  );
};
